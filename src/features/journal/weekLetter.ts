/**
 * Wren's weekly letter: a short note about the last seven days, written from the person's own
 * check-ins, journal feelings and practice sessions. The on-device letter is built from templates;
 * the optional AI version is only ever given the same plain facts (numbers, feeling names, short
 * trigger phrases), never entry text.
 */
import { addDays, parseDateKey } from '@/lib/dates';
import { AI_ENABLED, chatCompletion, type ChatMessage } from '@/services/ai/llm';
import type { CheckIn, PracticeSession } from '@/types/domain';

import { emotionMeta, isHeavy } from './analysis';
import { topEmotions, triggerSummary, type JournalInsightEntry } from './journalInsights';

export const LETTER_MIN_DAYS = 3;
const MOOD_WORDS = ['rough', 'low', 'okay', 'good', 'great'];

export interface WeekLetterInput {
  today: string;
  checkIns: Pick<CheckIn, 'dateKey' | 'mood' | 'sleepHours'>[];
  journal: JournalInsightEntry[];
  practices: Pick<PracticeSession, 'dateKey' | 'kind' | 'seconds'>[];
  sleepGoalHours: number;
}

export interface WeekLetter {
  from: string;
  to: string;
  /** Days with a check-in or a journal entry. */
  daysLogged: number;
  paragraphs: string[];
  /** The plain facts the letter was built from; also what the AI version is allowed to see. */
  facts: string[];
  source: 'local' | 'ai';
  model: string | null;
}

const weekday = (key: string) => parseDateKey(key).toLocaleDateString('en', { weekday: 'long' });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The last seven days ending today. Null until at least LETTER_MIN_DAYS days have something logged. */
export function buildWeekLetter(input: WeekLetterInput): WeekLetter | null {
  const to = input.today;
  const from = addDays(to, -6);
  const inWeek = (k: string) => k >= from && k <= to;
  const checkIns = input.checkIns.filter((c) => inWeek(c.dateKey)).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const journal = input.journal.filter((e) => inWeek(e.dateKey) && e.text.trim());
  const practices = input.practices.filter((p) => inWeek(p.dateKey));
  const days = new Set([...checkIns.map((c) => c.dateKey), ...journal.map((e) => e.dateKey)]);
  if (days.size < LETTER_MIN_DAYS) return null;

  const facts: string[] = [];
  const paragraphs: string[] = [];

  // What was logged and how the days felt.
  const opening = [`This week you checked in on ${plural(checkIns.length, 'day')}${journal.length ? ` and wrote ${plural(journal.length, 'journal entry', 'journal entries')}` : ''}.`];
  facts.push(`Check-ins: ${checkIns.length} of 7 days. Journal entries: ${journal.length}.`);
  if (checkIns.length) {
    const avg = mean(checkIns.map((c) => c.mood));
    const best = checkIns.reduce((a, b) => (b.mood > a.mood ? b : a));
    const worst = checkIns.reduce((a, b) => (b.mood < a.mood ? b : a));
    opening.push(`On average your days felt ${MOOD_WORDS[Math.round(avg) - 1]} (${avg.toFixed(1)} out of 5).`);
    facts.push(`Average mood ${avg.toFixed(1)}/5. Best day ${weekday(best.dateKey)} (${MOOD_WORDS[best.mood - 1]}). Hardest day ${weekday(worst.dateKey)} (${MOOD_WORDS[worst.mood - 1]}).`);
    if (best.mood > worst.mood) {
      opening.push(`${weekday(best.dateKey)} felt brightest${worst.mood <= 2 ? `, and ${weekday(worst.dateKey)} was the hardest` : ''}.`);
    }
  }
  paragraphs.push(opening.join(' '));

  // Sleep, and a this-week-only link between sleep and mood when it's clear.
  const slept = checkIns.filter((c) => c.sleepHours > 0);
  let sleepShort = false;
  if (slept.length >= 2) {
    const avgSleep = mean(slept.map((c) => c.sleepHours));
    const gap = input.sleepGoalHours - avgSleep;
    sleepShort = gap >= 0.75;
    const vsGoal = gap >= 0.75 ? `, under your ${input.sleepGoalHours}-hour goal` : gap <= -0.25 ? `, at or above your ${input.sleepGoalHours}-hour goal` : `, close to your ${input.sleepGoalHours}-hour goal`;
    const sleepLine = [`You slept about ${avgSleep.toFixed(1)} hours a night${vsGoal}.`];
    facts.push(`Average sleep ${avgSleep.toFixed(1)} h (goal ${input.sleepGoalHours} h).`);
    const sorted = [...slept].sort((a, b) => a.sleepHours - b.sleepHours);
    const half = Math.floor(sorted.length / 2);
    const lessSleep = sorted.slice(0, half);
    const moreSleep = sorted.slice(sorted.length - half);
    if (half >= 2 && mean(moreSleep.map((c) => c.sleepHours)) - mean(lessSleep.map((c) => c.sleepHours)) >= 1) {
      const diff = mean(moreSleep.map((c) => c.mood)) - mean(lessSleep.map((c) => c.mood));
      if (diff >= 0.75) {
        sleepLine.push('This week, the days after longer nights tended to feel better.');
        facts.push('This week, days after longer sleep had higher mood.');
      }
    }
    paragraphs.push(sleepLine.join(' '));
  }

  // Feelings from the journal.
  const feelings = topEmotions(journal, 3);
  const { shine, down } = triggerSummary(journal, 2);
  const heavyDays = new Set(journal.filter((e) => e.analysis && isHeavy(e.analysis)).map((e) => e.dateKey)).size;
  if (feelings.length) {
    const names = feelings.map((f) => emotionMeta(f.name).label.toLowerCase());
    const feel = [`In your journal, ${list(names)} came up most.`];
    if (down.length) feel.push(`${capital(list(down.map((t) => t.phrase)))} weighed on you${shine.length ? `, while ${list(shine.map((t) => t.phrase))} lifted you` : ''}.`);
    else if (shine.length) feel.push(`${capital(list(shine.map((t) => t.phrase)))} lifted you.`);
    paragraphs.push(feel.join(' '));
    facts.push(`Journal feelings: ${names.join(', ')}. Heavier journal days: ${heavyDays}.`);
    if (down.length) facts.push(`Weighing on them: ${down.map((t) => t.phrase).join(', ')}.`);
    if (shine.length) facts.push(`Lifting them: ${shine.map((t) => t.phrase).join(', ')}.`);
  }

  // Practices.
  const breathing = practices.filter((p) => p.kind === 'breathing').length;
  const focus = practices.filter((p) => p.kind === 'focus').length;
  if (breathing || focus) {
    const parts = [breathing ? plural(breathing, 'breathing break') : '', focus ? plural(focus, 'focus session') : ''].filter(Boolean);
    paragraphs.push(`You made time for ${list(parts)}.`);
    facts.push(`Practices: ${breathing} breathing, ${focus} focus.`);
  }

  // One gentle suggestion, from the strongest signal.
  paragraphs.push(
    heavyDays >= 3 ? 'It sounds like a heavy week. Go gently with yourself, and lean on the people and things that help.'
      : sleepShort ? 'If one thing could help next week, try protecting a single earlier night and see how the next day feels.'
        : shine.length ? `Next week, maybe make a little more room for ${shine[0].phrase}.`
          : 'Keep noticing how your days feel. A few lines each evening makes next week’s letter richer.',
  );

  return { from, to, daysLogged: days.size, paragraphs, facts, source: 'local', model: null };
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const SYSTEM = 'You are Wren, a gentle owl in WellTrack, a wellbeing app for students. Write a short weekly letter (70 to 120 words, 2 or 3 short paragraphs, no greeting line, no sign-off) to the student, using ONLY the facts provided. Do not invent events, numbers or feelings. No diagnosis, no medical advice, no lists. Warm, specific and plain. End with one small, kind suggestion for next week.';

/** Ask the AI to rewrite the letter from the same facts. Falls back to the on-device letter on any failure. */
export async function aiWeekLetter(letter: WeekLetter, opts: { idToken?: string | null }): Promise<{ letter: WeekLetter; error?: string }> {
  if (!AI_ENABLED) return { letter, error: 'Wren’s AI isn’t set up in this build.' };
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Facts about the student’s last 7 days:\n${letter.facts.map((f) => `- ${f}`).join('\n')}` },
  ];
  try {
    const { content, model } = await chatCompletion(messages, { idToken: opts.idToken, maxTokens: 900, timeoutMs: 45_000 });
    const paragraphs = content.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p && !/^[—-]\s*wren\.?$/i.test(p));
    const words = paragraphs.join(' ').split(/\s+/).length;
    if (!paragraphs.length || words < 30 || words > 220) return { letter, error: 'Wren’s reply didn’t look right, so this is the on-device letter.' };
    return { letter: { ...letter, paragraphs, source: 'ai', model } };
  } catch {
    return { letter, error: 'Couldn’t reach Wren just now, so this is the on-device letter.' };
  }
}
