/**
 * Weekly recap: the 7 days ending today compared with the 7 days before. Built only from
 * recorded data; replay sessions never count. Highlights are short factual sentences.
 */
import { totalsFor } from '@/features/analytics/aggregations';
import { addDays, lastNDays } from '@/lib/dates';
import type { ActivitySession, CheckIn } from '@/types/domain';
import { uniqueCheckIns } from './patterns';

export type Trend = 'up' | 'down' | 'flat';

export interface WeeklyRecap {
  from: string;
  to: string;
  checkInDays: number;
  avgSleep: number | null;
  avgMood: number | null;
  avgStress: number | null;
  prevAvgMood: number | null;
  prevAvgStress: number | null;
  moodTrend: Trend | null;
  stressTrend: Trend | null;
  goalCompletions: number;
  /** Live-tracked active (locomotion) minutes; null when nothing was tracked. */
  activeMinutes: number | null;
  trackedSessions: number;
  totalSteps: number | null;
  stepDays: number;
  bestDay: { dateKey: string; mood: number } | null;
  highlights: string[];
}

export interface WeeklyRecapInput {
  today: string;
  checkIns: CheckIn[];
  sessions: ActivitySession[];
  goalLogs: { goalId: number; dateKey: string }[];
  dailySteps: { dateKey: string; steps: number }[];
}

const FLAT_THRESHOLD = 0.3;
const MAX_HIGHLIGHTS = 4;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Integer with thousands separators, independent of the JS engine's locale support. */
export function formatThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function trend(cur: number | null, prev: number | null): Trend | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < FLAT_THRESHOLD) return 'flat';
  return d > 0 ? 'up' : 'down';
}

function trendSentence(name: string, t: Trend | null, cur: number | null, prev: number | null): string | null {
  if (t === null || cur === null || prev === null) return null;
  if (t === 'flat') return `${name} was about the same as last week (${fmt1(cur)} vs ${fmt1(prev)}).`;
  return `${name} was ${t} ${fmt1(Math.abs(cur - prev))} on last week (${fmt1(cur)} vs ${fmt1(prev)}).`;
}

export function weeklyRecap(input: WeeklyRecapInput): WeeklyRecap {
  const week = lastNDays(7, input.today);
  const prevWeek = lastNDays(7, addDays(input.today, -7));
  const inWeek = new Set(week);
  const inPrev = new Set(prevWeek);

  const checkIns = uniqueCheckIns(input.checkIns);
  const cur = checkIns.filter((c) => inWeek.has(c.dateKey));
  const prev = checkIns.filter((c) => inPrev.has(c.dateKey));

  const avgSleep = avg(cur.map((c) => c.sleepHours));
  const avgMood = avg(cur.map((c) => c.mood));
  const avgStress = avg(cur.map((c) => c.stressLevel));
  const prevAvgMood = avg(prev.map((c) => c.mood));
  const prevAvgStress = avg(prev.map((c) => c.stressLevel));
  const moodTrend = trend(avgMood, prevAvgMood);
  const stressTrend = trend(avgStress, prevAvgStress);

  const goalCompletions = input.goalLogs.filter((l) => inWeek.has(l.dateKey)).length;

  const totals = totalsFor(input.sessions.filter((s) => inWeek.has(s.dateKey)));
  const trackedSessions = totals.sessionCount;
  const activeMinutes = trackedSessions > 0 ? Math.round(totals.activeSeconds / 60) : null;

  const stepsByDay = new Map<string, number>();
  for (const d of input.dailySteps) {
    if (inWeek.has(d.dateKey) && Number.isFinite(d.steps) && d.steps >= 0) stepsByDay.set(d.dateKey, d.steps);
  }
  const stepDays = stepsByDay.size;
  const totalSteps = stepDays > 0 ? [...stepsByDay.values()].reduce((a, b) => a + b, 0) : null;

  // Best day needs at least two check-ins to be meaningful; ties go to the most recent day.
  let bestDay: WeeklyRecap['bestDay'] = null;
  if (cur.length >= 2) {
    for (const c of cur) if (!bestDay || c.mood >= bestDay.mood) bestDay = { dateKey: c.dateKey, mood: c.mood };
  }

  const candidates: (string | null)[] = [
    cur.length ? `You checked in on ${cur.length} of 7 days.` : null,
    trendSentence('Mood', moodTrend, avgMood, prevAvgMood),
    trendSentence('Stress', stressTrend, avgStress, prevAvgStress),
    avgSleep !== null ? `You averaged ${fmt1(avgSleep)} h of sleep across ${plural(cur.length, 'check-in')}.` : null,
    trackedSessions > 0
      ? `You tracked ${plural(trackedSessions, 'session')} with ${activeMinutes} active minutes.`
      : null,
    totalSteps !== null ? `You logged ${formatThousands(totalSteps)} steps across ${plural(stepDays, 'day')}.` : null,
    goalCompletions > 0 ? `You checked off goals ${goalCompletions} time${goalCompletions === 1 ? '' : 's'}.` : null,
  ];
  const highlights = candidates.filter((s): s is string => s !== null).slice(0, MAX_HIGHLIGHTS);

  return {
    from: week[0],
    to: week[6],
    checkInDays: cur.length,
    avgSleep,
    avgMood,
    avgStress,
    prevAvgMood,
    prevAvgStress,
    moodTrend,
    stressTrend,
    goalCompletions,
    activeMinutes,
    trackedSessions,
    totalSteps,
    stepDays,
    bestDay,
    highlights,
  };
}
