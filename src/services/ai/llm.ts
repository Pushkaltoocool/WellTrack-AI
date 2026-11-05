/**
 * LLM access for the AI coach via OpenRouter (OpenAI-compatible chat completions).
 *
 * Release builds should set EXPO_PUBLIC_AI_PROXY_URL: a server (see functions/) that holds the
 * OpenRouter key, verifies the caller's Firebase ID token and rate-limits per user.
 * EXPO_PUBLIC_OPENROUTER_API_KEY is for local development only — anything in the JS bundle
 * can be extracted from the app.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEV_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const PROXY_URL = process.env.EXPO_PUBLIC_AI_PROXY_URL;

/** Free models, tried in order by OpenRouter (re-checked 2026-10-31: the Gemma models were rate-limited upstream, Nemotron Ultra and Lightning answered). */
export const COACH_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-lightning:free'];

export const AI_ENABLED = !!(PROXY_URL || DEV_KEY);
export const AI_VIA_PROXY = !!PROXY_URL;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'rate-limit' | 'auth' | 'network' | 'timeout' | 'empty' | 'server' | 'config',
  ) {
    super(message);
  }
}

export function friendlyModelName(model: string | null | undefined): string {
  if (!model) return 'AI model';
  const id = model.split('/').pop()?.replace(':free', '') ?? model;
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type ChatOpts = { idToken?: string | null; signal?: AbortSignal; maxTokens?: number; timeoutMs?: number };

/** One retry when a model returns no visible text (reasoning models can spend the budget thinking). */
export async function chatCompletion(messages: ChatMessage[], opts: ChatOpts = {}): Promise<{ content: string; model: string | null }> {
  try {
    return await requestOnce(messages, opts);
  } catch (e) {
    if (e instanceof LlmError && e.kind === 'empty') return requestOnce(messages, { ...opts, maxTokens: (opts.maxTokens ?? 1500) * 2 });
    throw e;
  }
}

async function requestOnce(messages: ChatMessage[], opts: ChatOpts): Promise<{ content: string; model: string | null }> {
  if (!AI_ENABLED) throw new LlmError('The AI coach isn’t configured in this build.', 'config');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  opts.signal?.addEventListener('abort', () => controller.abort());
  // Reasoning models count their thinking against max_tokens, so keep effort low and the budget generous.
  const body = { models: COACH_MODELS, messages, max_tokens: opts.maxTokens ?? 1500, temperature: 0.6, reasoning: { effort: 'low', exclude: true } };
  let res: Response;
  try {
    res = await fetch(PROXY_URL || OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: PROXY_URL
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.idToken ?? ''}` }
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DEV_KEY}`,
            'HTTP-Referer': 'https://welltrackai-128b4.web.app',
            'X-Title': 'WellTrack AI',
          },
      body: JSON.stringify(body),
    });
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new LlmError('The coach took too long to answer. Please try again.', 'timeout');
    throw new LlmError('You appear to be offline. The coach needs an internet connection.', 'network');
  }
  clearTimeout(timer);
  if (res.status === 429) throw new LlmError('The coach has reached today’s free limit. Please try again later.', 'rate-limit');
  if (res.status === 401 || res.status === 403) {
    throw new LlmError(PROXY_URL ? 'Please sign in to use the coach.' : 'The coach’s API key was rejected.', 'auth');
  }
  if (!res.ok) throw new LlmError(`The coach is unavailable right now (error ${res.status}).`, 'server');
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string; error?: { message?: string } };
  if (json.error) throw new LlmError(json.error.message ?? 'The coach is unavailable right now.', 'server');
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new LlmError('The coach didn’t reply. Please try again.', 'empty');
  return { content, model: json.model ?? null };
}
