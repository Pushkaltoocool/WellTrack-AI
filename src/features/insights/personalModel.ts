/**
 * Personal, on-device stress model trained only on the user's own check-ins.
 *
 * Ridge regression on standardized features (closed form via the normal equations), evaluated
 * with leave-one-out cross-validation against a "predict your average" baseline. The model is
 * only offered ('ready') when it beats that baseline by a meaningful margin. Weights describe
 * associations in the user's data, not causes. Fully deterministic.
 */
import type { CheckIn } from '@/types/domain';
import { uniqueCheckIns, type DailyFactors } from './patterns';

export interface PersonalModelDriver {
  feature: string;
  label: string;
  /** Standardized coefficient: change in predicted stress (1–5) per 1 SD of the feature. */
  weight: number;
  direction: 'raises' | 'lowers';
}

export interface PersonalModel {
  status: 'insufficient' | 'not-better' | 'ready';
  n: number;
  minN: number;
  mae: number | null;
  baselineMae: number | null;
  /** 1 - mae / baselineMae */
  improvement: number | null;
  drivers: PersonalModelDriver[];
  predict: ((x: Partial<Record<string, number>>) => number) | null;
  trainedOn: { from: string; to: string } | null;
}

type CheckInFeature =
  | 'sleepHours'
  | 'studyHours'
  | 'screenTimeHours'
  | 'physicalActivityMinutes'
  | 'socialHours'
  | 'extracurricularHours'
  | 'academicPressure';

const CHECKIN_FEATURES: { key: CheckInFeature; label: string }[] = [
  { key: 'sleepHours', label: 'Sleep' },
  { key: 'studyHours', label: 'Study time' },
  { key: 'screenTimeHours', label: 'Screen time' },
  { key: 'physicalActivityMinutes', label: 'Physical activity' },
  { key: 'socialHours', label: 'Social time' },
  { key: 'extracurricularHours', label: 'Extracurriculars' },
  { key: 'academicPressure', label: 'Academic pressure' },
];

const STEPS_FEATURE = { key: 'steps', label: 'Steps' };
const STEPS_MIN_COVERAGE = 0.8;
const MIN_DRIVER_WEIGHT = 0.05;

const clampStress = (v: number) => Math.min(5, Math.max(1, v));

/** Solve A x = b by Gaussian elimination with partial pivoting. A is p×p (p is tiny). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const p = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('Singular system');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < p; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= p; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = M[i][p];
    for (let k = i + 1; k < p; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

interface Fit {
  mu: number[];
  sd: number[];
  beta: number[];
  intercept: number;
}

/** Raw feature rows; null = missing (only possible for steps). */
type Row = (number | null)[];

function stats(X: Row[], idx: number[], j: number): { mu: number; sd: number } {
  const vals = idx.map((i) => X[i][j]).filter((v): v is number => v !== null);
  if (!vals.length) return { mu: 0, sd: 0 };
  const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mu) ** 2, 0) / vals.length);
  return { mu, sd };
}

/** z-score; missing values and zero-variance features map to 0 (the training mean). */
const z = (v: number | null | undefined, mu: number, sd: number) =>
  v === null || v === undefined || !Number.isFinite(v) || sd === 0 ? 0 : (v - mu) / sd;

/** Ridge fit on rows `idx`. Features standardized on those rows; intercept (mean of y) unpenalized. */
function fitRidge(X: Row[], y: number[], idx: number[], lambda: number): Fit {
  const p = X[0].length;
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < p; j++) {
    const s = stats(X, idx, j);
    mu.push(s.mu);
    sd.push(s.sd);
  }
  const intercept = idx.reduce((a, i) => a + y[i], 0) / idx.length;
  const A = Array.from({ length: p }, (_, j) => Array.from({ length: p }, (_, k) => (j === k ? lambda : 0)));
  const b = new Array<number>(p).fill(0);
  for (const i of idx) {
    const zi = X[i].map((v, j) => z(v, mu[j], sd[j]));
    const yc = y[i] - intercept;
    for (let j = 0; j < p; j++) {
      b[j] += zi[j] * yc;
      for (let k = 0; k < p; k++) A[j][k] += zi[j] * zi[k];
    }
  }
  return { mu, sd, beta: solveLinear(A, b), intercept };
}

function predictWith(fit: Fit, row: Row): number {
  let s = fit.intercept;
  for (let j = 0; j < row.length; j++) s += fit.beta[j] * z(row[j], fit.mu[j], fit.sd[j]);
  return clampStress(s);
}

/**
 * Train a personal stress model. Status is 'insufficient' below `minN` check-in days,
 * 'not-better' when leave-one-out error doesn't beat the mean baseline by `minImprovement`,
 * otherwise 'ready' (and `predict` is provided).
 */
export function trainPersonalModel(
  checkIns: CheckIn[],
  extras?: DailyFactors[],
  opts?: { minN?: number; lambda?: number; minImprovement?: number },
): PersonalModel {
  const minN = opts?.minN ?? 30;
  const lambda = opts?.lambda ?? 1;
  const minImprovement = opts?.minImprovement ?? 0.2;

  const days = uniqueCheckIns(checkIns).filter((c) => Number.isFinite(c.stressLevel));
  const n = days.length;
  const empty = { n, minN, mae: null, baselineMae: null, improvement: null, drivers: [], predict: null };
  if (n < Math.max(minN, 3)) return { status: 'insufficient', ...empty, trainedOn: null };

  const trainedOn = { from: days[0].dateKey, to: days[n - 1].dateKey };

  // Candidate features: check-in fields, plus steps when most days have them.
  const stepsByDay = new Map<string, number>();
  for (const x of extras ?? []) {
    if (typeof x.steps === 'number' && Number.isFinite(x.steps)) stepsByDay.set(x.dateKey, x.steps);
  }
  const stepCoverage = days.filter((c) => stepsByDay.has(c.dateKey)).length / n;
  const candidates: { key: string; label: string; get: (c: CheckIn) => number | null }[] = CHECKIN_FEATURES.map((f) => ({
    ...f,
    get: (c: CheckIn) => (Number.isFinite(c[f.key]) ? c[f.key] : null),
  }));
  if (stepCoverage >= STEPS_MIN_COVERAGE) {
    candidates.push({ ...STEPS_FEATURE, get: (c) => stepsByDay.get(c.dateKey) ?? null });
  }

  // Drop features with no variance across the user's data.
  const all = days.map((_, i) => i);
  const features = candidates.filter((f) => {
    const col = days.map((c) => [f.get(c)]);
    return stats(col, all, 0).sd > 1e-9;
  });
  if (!features.length) return { status: 'not-better', ...empty, trainedOn };

  const X: Row[] = days.map((c) => features.map((f) => f.get(c)));
  const y = days.map((c) => c.stressLevel);

  // Leave-one-out CV for the model and for the mean baseline.
  const ySum = y.reduce((a, b) => a + b, 0);
  let errModel = 0;
  let errBase = 0;
  for (let i = 0; i < n; i++) {
    const train = all.filter((k) => k !== i);
    errModel += Math.abs(predictWith(fitRidge(X, y, train, lambda), X[i]) - y[i]);
    errBase += Math.abs((ySum - y[i]) / (n - 1) - y[i]);
  }
  const mae = errModel / n;
  const baselineMae = errBase / n;
  const improvement = baselineMae > 0 ? 1 - mae / baselineMae : null;

  const full = fitRidge(X, y, all, lambda);
  const drivers: PersonalModelDriver[] = features
    .map((f, j) => ({
      feature: f.key,
      label: f.label,
      weight: full.beta[j],
      direction: (full.beta[j] > 0 ? 'raises' : 'lowers') as PersonalModelDriver['direction'],
    }))
    .filter((d) => Math.abs(d.weight) >= MIN_DRIVER_WEIGHT)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.feature.localeCompare(b.feature));

  const ready = improvement !== null && improvement >= minImprovement;
  const predict = ready
    ? (x: Partial<Record<string, number>>) => predictWith(full, features.map((f) => x[f.key] ?? null))
    : null;

  return {
    status: ready ? 'ready' : 'not-better',
    n,
    minN,
    mae,
    baselineMae,
    improvement,
    drivers,
    predict,
    trainedOn,
  };
}
