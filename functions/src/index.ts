/**
 * AI coach proxy for release builds (set EXPO_PUBLIC_AI_PROXY_URL to this function's URL).
 * - Keeps the OpenRouter key server-side (secret OPENROUTER_API_KEY).
 * - Requires a Firebase ID token; anonymous calls are rejected.
 * - Rate-limits each user per UTC day and only allows the coach's model list.
 * - Never stores message content; only a per-user daily request counter.
 * Requires the Firebase Blaze plan. Deploy: firebase functions:secrets:set OPENROUTER_API_KEY && npm run deploy
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();
const OPENROUTER_API_KEY = defineSecret('OPENROUTER_API_KEY');

const ALLOWED_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-lightning:free'];
const DAILY_LIMIT = 30;
const MAX_TOKENS = 3000;
const MAX_MESSAGES = 30;
const MAX_CHARS = 20_000;

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

export const coach = onRequest(
  { secrets: [OPENROUTER_API_KEY], region: 'asia-northeast3', cors: false, maxInstances: 10, timeoutSeconds: 90 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed' } });
      return;
    }
    const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    let uid: string;
    try {
      uid = (await getAuth().verifyIdToken(token)).uid;
    } catch {
      res.status(401).json({ error: { message: 'Sign in to use the coach.' } });
      return;
    }

    const body = req.body as { messages?: Msg[]; max_tokens?: number; temperature?: number; reasoning?: unknown };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const valid =
      messages.length > 0 &&
      messages.length <= MAX_MESSAGES &&
      messages.every((m) => ['system', 'user', 'assistant'].includes(m?.role) && typeof m.content === 'string') &&
      messages.reduce((n, m) => n + m.content.length, 0) <= MAX_CHARS;
    if (!valid) {
      res.status(400).json({ error: { message: 'Invalid request.' } });
      return;
    }

    // Per-user daily quota (transaction so concurrent requests can't overshoot).
    const day = new Date().toISOString().slice(0, 10);
    const ref = getFirestore().doc(`aiUsage/${uid}_${day}`);
    const allowed = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.get('count') as number | undefined) ?? 0;
      if (count >= DAILY_LIMIT) return false;
      tx.set(ref, { uid, day, count: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!allowed) {
      res.status(429).json({ error: { message: 'Daily coach limit reached.' } });
      return;
    }

    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_API_KEY.value()}`,
        'HTTP-Referer': 'https://welltrackai-128b4.web.app',
        'X-Title': 'WellTrack AI',
      },
      body: JSON.stringify({
        models: ALLOWED_MODELS,
        messages,
        max_tokens: Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS),
        temperature: 0.6,
        reasoning: { effort: 'low', exclude: true },
      }),
    });
    const json = await upstream.json().catch(() => ({ error: { message: 'Bad upstream response' } }));
    res.status(upstream.ok ? 200 : upstream.status === 429 ? 429 : 502).json(json);
  },
);
