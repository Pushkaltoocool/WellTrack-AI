/** Glue between journal storage and emotion analysis. */
import type { Db } from '@/services/database/db';
import { getCheckIn, listJournalEntries, saveJournalEntry, setJournalAnalysis } from '@/services/database/repositories';
import type { JournalEntryRecord } from '@/types/domain';

import { analyzeEntry, deserializeAnalysis, emotionMeta, serializeAnalysis, type EmotionName, type JournalAnalysis } from './analysis';
import type { JournalInsightEntry } from './journalInsights';
import { parseTags, stripMarkdown } from './markdown';

export interface JournalEntry {
  id: number;
  dateKey: string;
  body: string;
  /** Body without formatting characters. */
  plain: string;
  prompt: string | null;
  tags: string[];
  writingSeconds: number;
  analysis: JournalAnalysis | null;
  createdAt: number;
  updatedAt: number;
}

export function toEntry(r: JournalEntryRecord): JournalEntry {
  return {
    id: r.id,
    dateKey: r.dateKey,
    body: r.body,
    plain: stripMarkdown(r.body),
    prompt: r.prompt,
    tags: parseTags(r.tags),
    writingSeconds: r.writingSeconds,
    analysis: deserializeAnalysis(r.analysisJson),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function loadJournal(db: Db, fromKey?: string, toKey?: string): Promise<JournalEntry[]> {
  return (await listJournalEntries(db, fromKey, toKey)).map(toEntry);
}

export const toInsightEntries = (entries: JournalEntry[]): JournalInsightEntry[] =>
  entries.map((e) => ({ dateKey: e.dateKey, text: e.plain, analysis: e.analysis }));

const analysisText = (e: { body: string }) => stripMarkdown(e.body);

/** Analyses an entry and stores the result. Returns the reading plus a user-facing reason if AI fell back to on-device. */
export async function analyzeAndStore(
  db: Db,
  entry: { id: number; body: string; prompt: string | null; dateKey: string },
  opts: { useAi: boolean; idToken?: string | null },
): Promise<{ analysis: JournalAnalysis; aiError?: string }> {
  const checkIn = await getCheckIn(db, entry.dateKey).catch(() => null);
  const result = await analyzeEntry(analysisText(entry), { useAi: opts.useAi, idToken: opts.idToken, mood: checkIn?.mood ?? null });
  await setJournalAnalysis(db, entry.id, serializeAnalysis(result.analysis));
  return result;
}

export async function saveEntry(
  db: Db,
  e: { id: number | null; dateKey: string; body: string; prompt: string | null; tags: string[]; addSeconds?: number },
): Promise<number> {
  return saveJournalEntry(db, { id: e.id, dateKey: e.dateKey, title: '', body: e.body, prompt: e.prompt, tags: e.tags.join(','), addSeconds: e.addSeconds });
}

const POSITIVE = ['#6E98C8', '#93B3D8', '#4F7FB5', '#B5CBE5'];
const NEGATIVE = ['#D9534A', '#E8938D', '#C0453D', '#EDB1AC'];
const NEUTRAL = ['#7C808A', '#8A8D93', '#B9BBC0', '#5C5F66'];

/** Stable colour per emotion: blues for lighter feelings, reds for heavier ones, greys for neutral. */
export function emotionColor(name: EmotionName): string {
  const meta = emotionMeta(name);
  const list = meta.valence === 'positive' ? POSITIVE : meta.valence === 'negative' ? NEGATIVE : NEUTRAL;
  let h = 0;
  for (const ch of name) h = (h * 17 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

export const INTENSITY_WORDS = ['', 'a little', 'quite', 'very'] as const;

export const SUGGESTED_TAGS = ['exams', 'study', 'friends', 'family', 'sleep', 'health', 'work', 'gratitude', 'relationships', 'money', 'sport', 'home'];
