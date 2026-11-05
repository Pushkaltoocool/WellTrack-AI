/**
 * Personal pattern finder: splits the user's own check-in days into two groups per factor
 * (e.g. slept at least the goal vs less) and compares average mood and stress.
 *
 * Results are associations in the user's own data, never causes. Every pattern carries its
 * group sizes, and nothing is returned until there is enough data to say something.
 */
import type { CheckIn, Preferences } from '@/types/domain';

export interface DailyFactors {
  dateKey: string;
  steps?: number | null;
  activeMinutes?: number | null;
}

export interface Pattern {
  /** `${factorKey}-${outcome}`, e.g. "sleep-mood". */
  id: string;
  /** Human-readable factor name, e.g. "Sleep". */
  factor: string;
  outcome: 'mood' | 'stress';
  text: string;
  highLabel: string;
  lowLabel: string;
  highMean: number;
  lowMean: number;
  highN: number;
  lowN: number;
  /** highMean - lowMean */
  diff: number;
  /** Whether the "high" group had the better outcome (higher mood / lower stress). */
  favourable: boolean;
}

export interface PatternResult {
  patterns: Pattern[];
  daysAnalysed: number;
  enoughData: boolean;
  daysNeeded: number;
}

type Group = 'high' | 'low' | null;

interface FactorDef {
  key: string;
  factor: string;
  highLabel: string;
  lowLabel: string;
  /** Sentence opener for the high group, e.g. "On days you slept at least 8 h". */
  highPhrase: string;
  /** Comparison phrase for the low group, e.g. "on shorter nights". */
  lowPhrase: string;
  group: (c: CheckIn, x: DailyFactors | undefined) => Group;
}

const MAX_RESULTS = 6;

const fmt1 = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return (Object.is(r, -0) ? 0 : r).toFixed(1);
};
const num = (n: number) => String(Math.round(n * 10) / 10);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function split(v: number | null | undefined, isHigh: (v: number) => boolean): Group {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return isHigh(v) ? 'high' : 'low';
}

/** One check-in per day (latest edit wins), oldest first. */
export function uniqueCheckIns(checkIns: CheckIn[]): CheckIn[] {
  const byDay = new Map<string, CheckIn>();
  for (const c of checkIns) {
    const prev = byDay.get(c.dateKey);
    if (!prev || c.updatedAt >= prev.updatedAt) byDay.set(c.dateKey, c);
  }
  return [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function factorDefs(prefs: Pick<Preferences, 'sleepGoalHours' | 'activeMinutesGoal'>, withExtras: boolean): FactorDef[] {
  const sg = prefs.sleepGoalHours;
  const ag = prefs.activeMinutesGoal;
  const defs: FactorDef[] = [
    {
      key: 'sleep',
      factor: 'Sleep',
      highLabel: `${num(sg)} h+ sleep`,
      lowLabel: `Under ${num(sg)} h sleep`,
      highPhrase: `On days you slept at least ${num(sg)} h`,
      lowPhrase: 'on shorter nights',
      group: (c) => split(c.sleepHours, (v) => v >= sg),
    },
    {
      key: 'study',
      factor: 'Study time',
      highLabel: 'Over 6 h study',
      lowLabel: '6 h study or less',
      highPhrase: 'On days you studied more than 6 h',
      lowPhrase: 'on days with 6 h or less',
      group: (c) => split(c.studyHours, (v) => v > 6),
    },
    {
      key: 'screen',
      factor: 'Screen time',
      highLabel: '4 h+ screen time',
      lowLabel: 'Under 4 h screen time',
      highPhrase: 'On days with 4 h or more of screen time',
      lowPhrase: 'on days with less',
      group: (c) => split(c.screenTimeHours, (v) => v >= 4),
    },
    {
      key: 'activity',
      factor: 'Physical activity',
      highLabel: '30+ min activity',
      lowLabel: 'Under 30 min activity',
      highPhrase: 'On days with 30 min or more of physical activity',
      lowPhrase: 'on less active days',
      group: (c) => split(c.physicalActivityMinutes, (v) => v >= 30),
    },
    {
      key: 'social',
      factor: 'Social time',
      highLabel: '1.5 h+ social time',
      lowLabel: 'Under 1.5 h social time',
      highPhrase: 'On days with 1.5 h or more of social time',
      lowPhrase: 'on days with less',
      group: (c) => split(c.socialHours, (v) => v >= 1.5),
    },
    {
      key: 'pressure',
      factor: 'Academic pressure',
      highLabel: 'Pressure 4–5',
      lowLabel: 'Pressure 1–3',
      highPhrase: 'On days academic pressure was 4 or 5 out of 5',
      lowPhrase: 'on lower-pressure days',
      group: (c) => split(c.academicPressure, (v) => v >= 4),
    },
  ];
  if (withExtras) {
    defs.push(
      {
        key: 'steps',
        factor: 'Steps',
        highLabel: '7,000+ steps',
        lowLabel: 'Under 7,000 steps',
        highPhrase: 'On days you walked 7,000 steps or more',
        lowPhrase: 'on days with fewer steps',
        group: (_c, x) => split(x?.steps, (v) => v >= 7000),
      },
      {
        key: 'activeMinutes',
        factor: 'Active minutes',
        highLabel: `${num(ag)}+ active min`,
        lowLabel: `Under ${num(ag)} active min`,
        highPhrase: `On days you reached ${num(ag)} active minutes`,
        lowPhrase: 'on days below that',
        group: (_c, x) => split(x?.activeMinutes, (v) => v >= ag),
      },
    );
  }
  return defs;
}

const OUTCOMES = [
  { outcome: 'mood' as const, noun: 'mood', pick: (c: CheckIn) => c.mood, higherIsBetter: true },
  { outcome: 'stress' as const, noun: 'stress', pick: (c: CheckIn) => c.stressLevel, higherIsBetter: false },
];

/**
 * Compare average mood and stress between "high" and "low" days for each factor.
 * Only differences of at least `minDiff` with `minPerGroup` days on both sides are reported.
 */
export function findPatterns(
  checkIns: CheckIn[],
  prefs: Pick<Preferences, 'sleepGoalHours' | 'activeMinutesGoal'>,
  extras?: DailyFactors[],
  opts?: { minPerGroup?: number; minDiff?: number; minDays?: number },
): PatternResult {
  const minPerGroup = opts?.minPerGroup ?? 3;
  const minDiff = opts?.minDiff ?? 0.5;
  const minDays = opts?.minDays ?? 7;

  const days = uniqueCheckIns(checkIns);
  const n = days.length;
  const enoughData = n >= minDays;
  const result = { daysAnalysed: n, enoughData, daysNeeded: Math.max(0, minDays - n) };
  if (!enoughData) return { patterns: [], ...result };

  const extraByDay = new Map((extras ?? []).map((x) => [x.dateKey, x]));
  const patterns: Pattern[] = [];

  for (const def of factorDefs(prefs, extras !== undefined)) {
    const high: CheckIn[] = [];
    const low: CheckIn[] = [];
    for (const c of days) {
      const g = def.group(c, extraByDay.get(c.dateKey));
      if (g === 'high') high.push(c);
      else if (g === 'low') low.push(c);
    }
    if (high.length < minPerGroup || low.length < minPerGroup) continue;

    for (const o of OUTCOMES) {
      const highMean = mean(high.map(o.pick));
      const lowMean = mean(low.map(o.pick));
      const diff = highMean - lowMean;
      if (!Number.isFinite(diff) || Math.abs(diff) < minDiff) continue;
      patterns.push({
        id: `${def.key}-${o.outcome}`,
        factor: def.factor,
        outcome: o.outcome,
        text:
          `${def.highPhrase}, your ${o.noun} averaged ${fmt1(highMean)} vs ${fmt1(lowMean)} ${def.lowPhrase} ` +
          `(${high.length} vs ${low.length} days).`,
        highLabel: def.highLabel,
        lowLabel: def.lowLabel,
        highMean,
        lowMean,
        highN: high.length,
        lowN: low.length,
        diff,
        favourable: o.higherIsBetter ? diff > 0 : diff < 0,
      });
    }
  }

  patterns.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.id.localeCompare(b.id));
  return { patterns: patterns.slice(0, MAX_RESULTS), ...result };
}
