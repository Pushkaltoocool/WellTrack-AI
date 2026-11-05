/**
 * Finding old pages: full-text search over the journal and "On this day" look-backs. Pure, so it
 * runs on-device over the already-loaded entries and can be unit-tested.
 */
import { addDays, dateKey, parseDateKey } from '@/lib/dates';

import { emotionMeta, type JournalAnalysis } from './analysis';

export interface RecallEntry {
  id: number;
  dateKey: string;
  /** Entry text with formatting markers removed. */
  plain: string;
  prompt: string | null;
  tags: string[];
  analysis: JournalAnalysis | null;
}

export interface SearchHit<E extends RecallEntry> {
  entry: E;
  /** A short excerpt around the first text match, or null when only tags/feelings matched. */
  snippet: string | null;
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Every term must match. `#tag` matches tags only; other terms match the text, the prompt, tags,
 * named feelings and what lifted or weighed on the writer. Newest entries first (input order kept).
 */
export function searchEntries<E extends RecallEntry>(entries: E[], query: string): SearchHit<E>[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: SearchHit<E>[] = [];
  for (const e of entries) {
    const text = fold(e.plain);
    const tags = e.tags.map(fold);
    const extra = fold([
      e.prompt ?? '',
      ...(e.analysis?.emotions.map((x) => emotionMeta(x.name).label) ?? []),
      ...(e.analysis?.triggers.map((t) => t.phrase) ?? []),
    ].join(' \n '));
    const ok = terms.every((t) => t.startsWith('#') ? tags.some((g) => g === t.slice(1) || (t.length > 2 && g.startsWith(t.slice(1)))) : text.includes(t) || extra.includes(t) || tags.some((g) => g.includes(t)));
    if (ok) hits.push({ entry: e, snippet: snippetFor(e.plain, terms.filter((t) => !t.startsWith('#'))) });
  }
  return hits;
}

const SNIPPET_RADIUS = 60;

export function snippetFor(plain: string, terms: string[]): string | null {
  const flat = plain.replace(/\s+/g, ' ').trim();
  const folded = fold(flat);
  let at = -1;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + SNIPPET_RADIUS * 2);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`;
}

export interface Lookback<E extends RecallEntry> {
  label: string;
  dateKey: string;
  entries: E[];
}

/** The same calendar day a year, a month and a week ago, oldest first. Skips days with nothing written. */
export function onThisDay<E extends RecallEntry>(entries: E[], today: string): Lookback<E>[] {
  const t = parseDateKey(today);
  const candidates: { label: string; key: string | null }[] = [
    { label: 'A year ago today', key: sameDay(t.getFullYear() - 1, t.getMonth(), t.getDate()) },
    { label: 'A month ago today', key: sameDay(t.getFullYear(), t.getMonth() - 1, t.getDate()) },
    { label: 'A week ago today', key: addDays(today, -7) },
  ];
  const out: Lookback<E>[] = [];
  for (const c of candidates) {
    if (!c.key) continue;
    const list = entries.filter((e) => e.dateKey === c.key && e.plain.trim());
    if (list.length) out.push({ label: c.label, dateKey: c.key, entries: list });
  }
  return out;
}

/** A date key for year/month/day, or null when that day doesn't exist (e.g. 31 Feb, 29 Feb). */
function sameDay(y: number, m: number, d: number): string | null {
  const x = new Date(y, m, d);
  const wantMonth = ((m % 12) + 12) % 12;
  return x.getDate() === d && x.getMonth() === wantMonth ? dateKey(x) : null;
}
