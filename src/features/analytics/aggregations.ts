/** Pure aggregation helpers for dashboards and trend charts. Replay sessions are always excluded. */
import {
  ACTIVE_CLASSES,
  HAR_CLASSES,
  SEDENTARY_CLASSES,
  emptyDurations,
  type ActivityDurations,
  type ActivitySession,
  type CheckIn,
} from '@/types/domain';

export interface ActivityTotals {
  durations: ActivityDurations;
  trackedSeconds: number;
  activeSeconds: number;
  sedentarySeconds: number;
  standingSeconds: number;
  steps: number | null;
  sessionCount: number;
}

export function totalsFor(sessions: ActivitySession[]): ActivityTotals {
  const durations = emptyDurations();
  let steps: number | null = null;
  let count = 0;
  for (const s of sessions) {
    if (s.source !== 'live') continue;
    count++;
    for (const c of HAR_CLASSES) durations[c] += s.durations[c] ?? 0;
    if (s.steps !== null) steps = (steps ?? 0) + s.steps;
  }
  const sumOf = (cls: readonly string[]) => cls.reduce((a, c) => a + durations[c as keyof ActivityDurations], 0);
  return {
    durations,
    trackedSeconds: HAR_CLASSES.reduce((a, c) => a + durations[c], 0),
    activeSeconds: sumOf(ACTIVE_CLASSES),
    sedentarySeconds: sumOf(SEDENTARY_CLASSES),
    standingSeconds: durations.STANDING,
    steps,
    sessionCount: count,
  };
}

export interface DailyActivity extends ActivityTotals {
  dateKey: string;
}

export function dailyActivity(sessions: ActivitySession[], days: string[]): DailyActivity[] {
  const byDay = new Map<string, ActivitySession[]>();
  for (const s of sessions) {
    if (s.source !== 'live') continue;
    const list = byDay.get(s.dateKey) ?? [];
    list.push(s);
    byDay.set(s.dateKey, list);
  }
  return days.map((d) => ({ dateKey: d, ...totalsFor(byDay.get(d) ?? []) }));
}

export interface SeriesPoint {
  dateKey: string;
  value: number | null;
}

export function checkInSeries(
  checkIns: CheckIn[],
  days: string[],
  pick: (c: CheckIn) => number,
): SeriesPoint[] {
  const byDay = new Map(checkIns.map((c) => [c.dateKey, c]));
  return days.map((d) => {
    const c = byDay.get(d);
    return { dateKey: d, value: c ? pick(c) : null };
  });
}

export function seriesAverage(points: SeriesPoint[]): number | null {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function goalCompletionByDay(
  logs: { goalId: number; dateKey: string }[],
  days: string[],
): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const l of logs) counts.set(l.dateKey, (counts.get(l.dateKey) ?? 0) + 1);
  return days.map((d) => ({ dateKey: d, value: counts.get(d) ?? 0 }));
}
