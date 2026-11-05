/**
 * Pure aggregations over journal entries and their analyses: frequent feelings, what lifts or
 * weighs on the writer, heavy stretches, a per-day timeline, word cloud data and a short,
 * privacy-safe summary for the coach. Nothing here quotes entry text except `topWords`, which
 * stays on-device.
 */
import { addDays, lastNDays } from '@/lib/dates';

import { emotionMeta, isHeavy, type EmotionName, type JournalAnalysis } from './analysis';

export interface JournalInsightEntry {
  /** Local YYYY-MM-DD. */
  dateKey: string;
  text: string;
  analysis: JournalAnalysis | null;
}

/** An analysis that actually read something (not the empty "not enough to read" result). */
function isReadable(a: JournalAnalysis | null): a is JournalAnalysis {
  return !!a && (a.emotions.length > 0 || a.sentiment !== 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------

export interface EmotionCount {
  name: EmotionName;
  /** Number of entries in which the emotion appears (each entry counts once). */
  count: number;
  /** count / entries with at least one emotion, 0..1. */
  share: number;
}

/**
 * Most frequent feelings. `count` is the number of entries naming the feeling (not weighted by
 * intensity); ties are broken by summed intensity, then by most recent appearance. `share` is
 * relative to entries that have at least one emotion. Empty when nothing has been analysed.
 */
export function topEmotions(entries: JournalInsightEntry[], limit = 3): EmotionCount[] {
  const withEmotions = entries.filter((e) => e.analysis && e.analysis.emotions.length > 0);
  if (!withEmotions.length) return [];
  const agg = new Map<EmotionName, { count: number; weight: number; latest: string }>();
  for (const e of withEmotions) {
    for (const em of e.analysis!.emotions) {
      const a = agg.get(em.name) ?? { count: 0, weight: 0, latest: '' };
      a.count += 1;
      a.weight += em.intensity;
      if (e.dateKey > a.latest) a.latest = e.dateKey;
      agg.set(em.name, a);
    }
  }
  return [...agg.entries()]
    .sort((x, y) => y[1].count - x[1].count || y[1].weight - x[1].weight || y[1].latest.localeCompare(x[1].latest) || x[0].localeCompare(y[0]))
    .slice(0, Math.max(0, limit))
    .map(([name, a]) => ({ name, count: a.count, share: round2(a.count / withEmotions.length) }));
}

// ---------------------------------------------------------------------------------------------

export interface TriggerCount {
  phrase: string;
  count: number;
}

/** Lower-case, strip punctuation, collapse spaces. */
export function normalizePhrase(phrase: string): string {
  return (phrase ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[^a-z0-9à-ÿ' &/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (/(?:ss|us|is|ous)$/.test(word)) return word;
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:sses|xes|ches|shes|zes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Merge key: normalised phrase with its last word singularised ("exams" ~ "exam"). */
function phraseKey(phrase: string): string {
  const words = normalizePhrase(phrase).split(' ');
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(' ');
}

/**
 * What lifted (`shine`) and weighed on (`down`) the writer. Each entry counts a phrase once per
 * valence. Similar phrases are merged ("Exams" / "exam"); the label shown is the most recent
 * spelling. Sorted by count, then most recent.
 */
export function triggerSummary(entries: JournalInsightEntry[], limit = 3): { shine: TriggerCount[]; down: TriggerCount[] } {
  type Agg = { phrase: string; count: number; latest: string };
  const pos = new Map<string, Agg>();
  const neg = new Map<string, Agg>();
  // Oldest first so later entries overwrite the display label.
  const sorted = [...entries].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  for (const e of sorted) {
    if (!e.analysis) continue;
    const seen = new Set<string>();
    for (const t of e.analysis.triggers) {
      const phrase = normalizePhrase(t.phrase);
      if (!phrase) continue;
      const key = phraseKey(phrase);
      const seenKey = `${t.valence}:${key}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      const map = t.valence === 'positive' ? pos : neg;
      const a = map.get(key) ?? { phrase, count: 0, latest: '' };
      a.count += 1;
      if (e.dateKey >= a.latest) {
        a.latest = e.dateKey;
        a.phrase = phrase;
      }
      map.set(key, a);
    }
  }
  const top = (m: Map<string, Agg>) =>
    [...m.values()]
      .sort((x, y) => y.count - x.count || y.latest.localeCompare(x.latest) || x.phrase.localeCompare(y.phrase))
      .slice(0, Math.max(0, limit))
      .map(({ phrase, count }) => ({ phrase, count }));
  return { shine: top(pos), down: top(neg) };
}

// ---------------------------------------------------------------------------------------------

export interface HeavyStretch {
  heavyDays: number;
  windowDays: 7;
  /** Most frequent negative feelings in the heavy entries of the window (up to 3). */
  topNegative: EmotionName[];
}

export const HEAVY_STRETCH_MIN_DAYS = 3;

/**
 * Non-null when at least 3 distinct days in the last 7 (today inclusive) have a heavy entry
 * (see `isHeavy`). Several entries on one day count as one day.
 */
export function heavyStretch(entries: JournalInsightEntry[], todayKey: string): HeavyStretch | null {
  const window = new Set(lastNDays(7, todayKey));
  const heavy = entries.filter((e) => window.has(e.dateKey) && e.analysis && isHeavy(e.analysis));
  const days = new Set(heavy.map((e) => e.dateKey));
  if (days.size < HEAVY_STRETCH_MIN_DAYS) return null;
  const counts = new Map<EmotionName, number>();
  for (const e of heavy) {
    for (const em of e.analysis!.emotions) {
      if (emotionMeta(em.name).valence === 'negative') counts.set(em.name, (counts.get(em.name) ?? 0) + 1);
    }
  }
  const topNegative = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([n]) => n);
  return { heavyDays: days.size, windowDays: 7, topNegative };
}

// ---------------------------------------------------------------------------------------------

export interface TimelinePoint {
  dateKey: string;
  /** Average sentiment of that day's readable analyses, or null when none. */
  sentiment: number | null;
  /** Emotion with the highest summed intensity that day (ties: first seen). */
  dominant: EmotionName | null;
}

export function emotionTimeline(entries: JournalInsightEntry[], days: string[]): TimelinePoint[] {
  const byDay = new Map<string, JournalAnalysis[]>();
  for (const e of entries) {
    if (!isReadable(e.analysis)) continue;
    const list = byDay.get(e.dateKey) ?? [];
    list.push(e.analysis);
    byDay.set(e.dateKey, list);
  }
  return days.map((dateKey) => {
    const list = byDay.get(dateKey);
    if (!list?.length) return { dateKey, sentiment: null, dominant: null };
    const sentiment = round2(list.reduce((s, a) => s + a.sentiment, 0) / list.length);
    const weights = new Map<EmotionName, number>();
    for (const a of list) for (const em of a.emotions) weights.set(em.name, (weights.get(em.name) ?? 0) + em.intensity);
    let dominant: EmotionName | null = null;
    let best = 0;
    for (const [name, w] of weights) {
      if (w > best) {
        best = w;
        dominant = name;
      }
    }
    return { dateKey, sentiment, dominant };
  });
}

// ---------------------------------------------------------------------------------------------

function words(text: string): string[] {
  return (text ?? '').trim().match(/\S+/g) ?? [];
}

export function writingStats(entries: JournalInsightEntry[]): { entries: number; words: number; daysWritten: number } {
  return {
    entries: entries.length,
    words: entries.reduce((s, e) => s + words(e.text).length, 0),
    daysWritten: new Set(entries.filter((e) => (e.text ?? '').trim()).map((e) => e.dateKey)).size,
  };
}

/** English stopwords plus journaling filler ("today", "feel", "really"…). Apostrophes removed. */
const STOPWORDS = new Set(
  `a about above after again against all almost also although always am among an and another any anybody anyone anything
anyway anyways are aren't around as at away back be became because become been before being below beside besides between
beyond both but by can can't cannot could couldn't did didn't do does doesn't doing don't done down during each either else
enough even ever every everybody everyone everything few for from further get gets getting got gotten had hadn't has hasn't
have haven't having he he'd he'll he's her here here's hers herself him himself his how how's however i i'd i'll i'm i've
if in into is isn't it it'd it'll it's its itself just let let's lot lots made make makes making many may maybe me might
mine more most much must mustn't my myself near need needed needs never next no nobody none nor not nothing now of off often
oh ok okay on once one ones only onto or other others otherwise ought our ours ourselves out over own per perhaps quite
rather really said same say says see seem seemed seems shall shan't she she'd she'll she's should shouldn't since so some
somebody someone something sometimes somewhat soon still such than that that's the their theirs them themselves then there
there's these they they'd they'll they're they've thing things think thinking thought this those though through thus till
to today tomorrow tonight too toward towards under until up upon us very via was wasn't way we we'd we'll we're we've well
were weren't what what's whatever when when's where where's whether which while who who's whom whose why why's will with
within without won't would wouldn't yeah yes yesterday yet you you'd you'll you're you've your yours yourself yourselves
feel feels feeling felt day days week like kind sort bit got gonna wanna gotta went go goes going come came also actually
basically literally pretty stuff time times kinda dont didnt doesnt cant couldnt wont wouldnt shouldnt isnt wasnt arent
werent ive im youre theyre thats theres whats lets hes shes its itd ill id youd youll weve theyve just tho thru etc
morning afternoon evening night tonight right left last first another every`
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/'/g, '')),
);

export interface WordCount {
  word: string;
  count: number;
}

/** Word-cloud data: lower-cased words of 3+ letters, no numbers, no stopwords. Sorted by count, then A–Z. */
export function topWords(entries: JournalInsightEntry[], limit = 20): WordCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const tokens = (e.text ?? '')
      .toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/'s\b/g, '')
      .replace(/'/g, '')
      .split(/[^a-z0-9à-ÿ]+/);
    for (const w of tokens) {
      if (w.length < 3 || /\d/.test(w) || STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([word, count]) => ({ word, count }));
}

// ---------------------------------------------------------------------------------------------

export const COACH_JOURNAL_SUMMARY_MAX_CHARS = 500;

/**
 * Short plain-text summary of the last 14 days for the coach's context. Uses only feeling names,
 * counts and short trigger phrases — never entry text. '' when nothing in the window was analysed.
 */
export function journalSummaryForCoach(entries: JournalInsightEntry[], todayKey: string): string {
  const from = addDays(todayKey, -13);
  const recent = entries.filter((e) => e.dateKey >= from && e.dateKey <= todayKey);
  if (!recent.some((e) => isReadable(e.analysis))) return '';

  const parts: string[] = [`Journal, last 14 days: ${recent.length} ${recent.length === 1 ? 'entry' : 'entries'}.`];
  const feelings = topEmotions(recent, 3);
  if (feelings.length) parts.push(`Most frequent feelings: ${feelings.map((f) => `${f.name} (${f.count})`).join(', ')}.`);
  const heavyDays = new Set(recent.filter((e) => e.analysis && isHeavy(e.analysis)).map((e) => e.dateKey)).size;
  if (heavyDays) parts.push(`Heavier days: ${heavyDays} of 14.`);
  const { shine, down } = triggerSummary(recent, 3);
  if (down.length) parts.push(`Weighing on them: ${down.map((t) => t.phrase).join(', ')}.`);
  if (shine.length) parts.push(`Lifting them: ${shine.map((t) => t.phrase).join(', ')}.`);

  // Drop trailing parts (least important first) rather than cutting mid-phrase.
  while (parts.length > 1 && parts.join(' ').length > COACH_JOURNAL_SUMMARY_MAX_CHARS) parts.pop();
  const text = parts.join(' ');
  return text.length > COACH_JOURNAL_SUMMARY_MAX_CHARS ? `${text.slice(0, COACH_JOURNAL_SUMMARY_MAX_CHARS - 1)}…` : text;
}
