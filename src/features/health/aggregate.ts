/**
 * Pure aggregation helpers for Apple Health data. No native imports — safe to unit test and to
 * import anywhere (including Expo Go). All date keys are LOCAL calendar dates (see `@/lib/dates`).
 */
import { addDays, dateKey, parseDateKey } from '@/lib/dates';

import type { DailyHealth, HealthMetric, Interval, SleepSample } from './types';

const MINUTE_MS = 60_000;

/** Asleep blocks separated by less than this belong to the same night (e.g. waking at 3am). */
export const SLEEP_SESSION_GAP_MS = 3 * 60 * MINUTE_MS;

export const METRIC_FIELD = {
  sleep: 'asleepMinutes',
  steps: 'steps',
  activeEnergy: 'activeEnergyKcal',
  mindful: 'mindfulMinutes',
  daylight: 'daylightMinutes',
} as const satisfies Record<HealthMetric, keyof Omit<DailyHealth, 'dateKey'>>;

export type HealthField = (typeof METRIC_FIELD)[HealthMetric] | 'inBedMinutes';

/** Per-day values keyed by local date key. */
export type DayValues = Record<string, number>;

// ---------- intervals ----------

function validIntervals<T extends Interval>(intervals: readonly T[]): T[] {
  return intervals.filter(
    (i) => Number.isFinite(i.start.getTime()) && Number.isFinite(i.end.getTime()) && i.end.getTime() > i.start.getTime(),
  );
}

/** Union of intervals: overlapping or touching intervals are merged, so nothing is counted twice. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = validIntervals(intervals)
    .map((i) => ({ start: i.start.getTime(), end: i.end.getTime() }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out.map((i) => ({ start: new Date(i.start), end: new Date(i.end) }));
}

function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((s, i) => s + (i.end.getTime() - i.start.getTime()), 0) / MINUTE_MS;
}

function startOfNextLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); // DST-safe
}

/**
 * Splits intervals at local midnight and sums minutes per local day. Intervals are merged first,
 * so overlapping samples from several apps/devices are never double counted.
 */
export function bucketMinutesByDay(intervals: readonly Interval[]): DayValues {
  const out: DayValues = {};
  for (const i of mergeIntervals(intervals)) {
    let t = i.start.getTime();
    const end = i.end.getTime();
    while (t < end) {
      const cut = Math.min(end, startOfNextLocalDay(t));
      const key = dateKey(t);
      out[key] = (out[key] ?? 0) + (cut - t) / MINUTE_MS;
      t = cut;
    }
  }
  return out;
}

// ---------- sleep ----------

export type SleepKind = 'asleep' | 'inBed' | 'awake';

/** Maps a raw HKCategoryValueSleepAnalysis value to asleep (core/deep/REM/unspecified), inBed or awake. */
export function classifySleepValue(value: number): SleepKind | null {
  switch (value) {
    case 0:
      return 'inBed';
    case 1: // asleepUnspecified (legacy "asleep")
    case 3: // asleepCore
    case 4: // asleepDeep
    case 5: // asleepREM
      return 'asleep';
    case 2:
      return 'awake';
    default:
      return null;
  }
}

const STAGED_VALUES = new Set([3, 4, 5]);

/** Groups merged blocks into sessions (nights/naps): blocks closer than `gapMs` join one session. */
function sessions(blocks: readonly Interval[], gapMs: number): Interval[][] {
  const out: Interval[][] = [];
  for (const b of blocks) {
    const cur = out[out.length - 1];
    const last = cur?.[cur.length - 1];
    if (cur && last && b.start.getTime() - last.end.getTime() < gapMs) cur.push(b);
    else out.push([b]);
  }
  return out;
}

/** Sums each session's merged minutes onto the local date the session ended (the day you woke up). */
function minutesByWakeDay(intervals: readonly Interval[], gapMs: number): DayValues {
  const out: DayValues = {};
  for (const s of sessions(mergeIntervals(intervals), gapMs)) {
    const key = dateKey(s[s.length - 1].end);
    out[key] = (out[key] ?? 0) + totalMinutes(s);
  }
  return out;
}

/**
 * Asleep and in-bed minutes per night, attributed to the local date the person woke up.
 *
 * - Samples from all sources (Apple Watch, iPhone, third-party apps) are merged, so overlapping
 *   samples are never double counted.
 * - Within a night, if any source recorded sleep stages (core/deep/REM — Apple Watch style), only
 *   stage-recording sources count towards "asleep", so a coarse "asleep" block from another app
 *   cannot paper over the awake periods the Watch detected.
 * - `inBed` is the union of in-bed samples only (null for nights with no in-bed sample).
 */
export function sleepByNight(
  samples: readonly SleepSample[],
  gapMs: number = SLEEP_SESSION_GAP_MS,
): { asleep: DayValues; inBed: DayValues } {
  const valid = validIntervals(samples);
  const asleepSamples = valid.filter((s) => classifySleepValue(s.value) === 'asleep');
  const inBedSamples = valid.filter((s) => classifySleepValue(s.value) === 'inBed');

  const asleep: DayValues = {};
  for (const night of sessions(mergeIntervals(asleepSamples), gapMs)) {
    const from = night[0].start.getTime();
    const to = night[night.length - 1].end.getTime();
    const inNight = asleepSamples.filter((s) => s.start.getTime() < to && s.end.getTime() > from);
    const stagedSources = new Set(inNight.filter((s) => STAGED_VALUES.has(s.value)).map((s) => s.source ?? ''));
    const counted = stagedSources.size > 0 ? inNight.filter((s) => stagedSources.has(s.source ?? '')) : inNight;
    const merged = mergeIntervals(counted);
    if (merged.length === 0) continue;
    const key = dateKey(merged[merged.length - 1].end);
    asleep[key] = (asleep[key] ?? 0) + totalMinutes(merged);
  }

  return { asleep, inBed: minutesByWakeDay(inBedSamples, gapMs) };
}

// ---------- rows ----------

/** Inclusive list of local date keys from `fromKey` to `toKey` (empty when from > to). */
export function dateKeysInRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  // Zero-padded YYYY-MM-DD keys compare correctly as strings.
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) out.push(k);
  return out;
}

/** Local-midnight bounds for a date-key range: `[start of fromKey, start of the day after toKey)`. */
export function rangeBounds(fromKey: string, toKey: string): { start: Date; end: Date } {
  return { start: parseDateKey(fromKey), end: parseDateKey(addDays(toKey, 1)) };
}

/**
 * One row per day in range. A metric whose map is `null`/missing (failed or not read) is null for
 * every day; a day absent from a map is null (no data).
 */
export function buildDailyRows(
  fromKey: string,
  toKey: string,
  values: Partial<Record<Exclude<keyof DailyHealth, 'dateKey'>, DayValues | null>>,
): DailyHealth[] {
  const pick = (m: DayValues | null | undefined, key: string): number | null => {
    const v = m?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return dateKeysInRange(fromKey, toKey).map((key) => ({
    dateKey: key,
    asleepMinutes: pick(values.asleepMinutes, key),
    inBedMinutes: pick(values.inBedMinutes, key),
    steps: pick(values.steps, key),
    activeEnergyKcal: pick(values.activeEnergyKcal, key),
    mindfulMinutes: pick(values.mindfulMinutes, key),
    daylightMinutes: pick(values.daylightMinutes, key),
  }));
}

// ---------- averages ----------

function fieldOf(metric: HealthMetric | 'inBed'): HealthField {
  return metric === 'inBed' ? 'inBedMinutes' : METRIC_FIELD[metric];
}

/** Average of a metric over the days that have data; null when no day has data. */
export function averageOf(rows: readonly DailyHealth[], metric: HealthMetric | 'inBed'): number | null {
  const field = fieldOf(metric);
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    const v = r[field];
    if (v !== null) {
      sum += v;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Twelve monthly averages (Jan..Dec) for `year`, each averaged over the days in that month that
 * have data; null for months with no data.
 */
export function monthlyAverages(
  rows: readonly DailyHealth[],
  year: number,
  metric: HealthMetric | 'inBed',
): (number | null)[] {
  const byMonth: DailyHealth[][] = Array.from({ length: 12 }, () => []);
  const prefix = `${year}-`;
  for (const r of rows) {
    if (!r.dateKey.startsWith(prefix)) continue;
    const m = Number(r.dateKey.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) byMonth[m].push(r);
  }
  return byMonth.map((monthRows) => averageOf(monthRows, metric));
}
