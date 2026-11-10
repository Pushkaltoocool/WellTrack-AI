/**
 * Honest, descriptive links between measured movement and self-reported stress. This is not a
 * prediction model: it compares the user's own days and says so, until enough labelled data
 * exists to train one (see dailyFeatures.ts).
 */
export interface StressPair {
  stressLevel: number | null;
  activeMinutes: number | null;
}

export interface StressSignal {
  /** Days with both a stress rating and measured movement. */
  days: number;
  /** Pearson correlation between active minutes and stress, or null when undefined. */
  r: number | null;
  /** Median active minutes; days at or above it count as "more active". */
  thresholdMin: number | null;
  moreActiveStress: number | null;
  lessActiveStress: number | null;
  /** One plain sentence, or null if there isn't enough data. */
  sentence: string | null;
}

export const MIN_DAYS = 7;
const MIN_PER_GROUP = 3;
const MEANINGFUL_GAP = 0.3; // on the 1–5 stress scale

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function pearson(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

export function stressVsActivity(rows: readonly StressPair[]): StressSignal {
  const pairs = rows.filter((r): r is { stressLevel: number; activeMinutes: number } => r.stressLevel !== null && r.activeMinutes !== null);
  const empty: StressSignal = { days: pairs.length, r: null, thresholdMin: null, moreActiveStress: null, lessActiveStress: null, sentence: null };
  if (pairs.length < MIN_DAYS) return empty;
  const sorted = pairs.map((p) => p.activeMinutes).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length / 2)];
  const more = pairs.filter((p) => p.activeMinutes >= threshold).map((p) => p.stressLevel);
  const less = pairs.filter((p) => p.activeMinutes < threshold).map((p) => p.stressLevel);
  const r = pearson(pairs.map((p) => p.activeMinutes), pairs.map((p) => p.stressLevel));
  if (more.length < MIN_PER_GROUP || less.length < MIN_PER_GROUP) return { ...empty, r };
  const a = mean(more);
  const b = mean(less);
  const fmt = (v: number) => v.toFixed(1);
  const sentence =
    Math.abs(a - b) < MEANINGFUL_GAP
      ? 'So far your stress looks about the same on more and less active days.'
      : `Your stress tends to be ${a < b ? 'lower' : 'higher'} on days you move ${Math.round(threshold)}+ minutes (${fmt(a)} vs ${fmt(b)} out of 5).`;
  return { days: pairs.length, r, thresholdMin: threshold, moreActiveStress: a, lessActiveStress: b, sentence };
}
