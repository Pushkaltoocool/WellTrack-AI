/**
 * HAR feature extraction — TypeScript port of ml/har/features.py.
 *
 * Any change here must be mirrored in the Python reference (and vice versa);
 * tests/harParity.test.ts compares both implementations on held-out fixtures.
 */

export const SAMPLE_RATE_HZ = 50;
export const WINDOW_SIZE = 128;
export const WINDOW_STEP = 64;

export const CHANNELS = ['acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z'] as const;
const SIGNALS = [...CHANNELS, 'acc_mag', 'gyro_mag'] as const;
const STATS = ['mean', 'std', 'min', 'max', 'median', 'iqr', 'mad', 'rms', 'jerk_std'] as const;
const CORR_PAIRS: readonly [number, number][] = [
  [0, 1], [0, 2], [1, 2],
  [3, 4], [3, 5], [4, 5],
];
const SPECTRAL_SIGNALS = ['acc_mag', 'gyro_mag'] as const;
const SPECTRAL_STATS = ['dom_freq', 'mean_freq'] as const;

/** Six channels of WINDOW_SIZE samples: acc (g) xyz, gyro (rad/s) xyz. */
export type SensorWindow = readonly (readonly number[] | Float64Array)[];

export function featureNames(): string[] {
  const names: string[] = [];
  for (const sig of SIGNALS) for (const stat of STATS) names.push(`${sig}_${stat}`);
  for (const [a, b] of CORR_PAIRS) names.push(`corr_${CHANNELS[a]}_${CHANNELS[b]}`);
  for (const sig of SPECTRAL_SIGNALS) for (const stat of SPECTRAL_STATS) names.push(`${sig}_${stat}`);
  return names;
}

export const FEATURE_COUNT = SIGNALS.length * STATS.length + CORR_PAIRS.length + SPECTRAL_SIGNALS.length * SPECTRAL_STATS.length;

function median3(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = Float64Array.from(x as ArrayLike<number>);
  for (let i = 1; i < n - 1; i++) {
    const a = x[i - 1];
    const b = x[i];
    const c = x[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

function percentileLinear(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Pairwise summation keeps float behaviour close to numpy.sum. */
function sum(x: Float64Array): number {
  return pairwiseSum(x, 0, x.length);
}

function pairwiseSum(x: Float64Array, start: number, end: number): number {
  const n = end - start;
  if (n <= 8) {
    let s = 0;
    for (let i = start; i < end; i++) s += x[i];
    return s;
  }
  const mid = start + Math.floor(n / 2);
  return pairwiseSum(x, start, mid) + pairwiseSum(x, mid, end);
}

function stats(x: Float64Array, out: number[]): void {
  const n = x.length;
  const mean = sum(x) / n;
  const dev = new Float64Array(n);
  const dev2 = new Float64Array(n);
  const absDev = new Float64Array(n);
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    dev[i] = d;
    dev2[i] = d * d;
    absDev[i] = Math.abs(d);
    sq[i] = x[i] * x[i];
  }
  const std = Math.sqrt(sum(dev2) / n);
  const sorted = Float64Array.from(x).sort();
  const median = percentileLinear(sorted, 0.5);
  const iqr = percentileLinear(sorted, 0.75) - percentileLinear(sorted, 0.25);
  const mad = sum(absDev) / n;
  const rms = Math.sqrt(sum(sq) / n);
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = (x[i + 1] - x[i]) * SAMPLE_RATE_HZ;
  const dm = sum(d) / d.length;
  const dd = new Float64Array(d.length);
  for (let i = 0; i < d.length; i++) dd[i] = (d[i] - dm) * (d[i] - dm);
  const jerkStd = Math.sqrt(sum(dd) / d.length);
  out.push(mean, std, sorted[0], sorted[n - 1], median, iqr, mad, rms, jerkStd);
}

function corr(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  const ma = sum(a) / n;
  const mb = sum(b) / n;
  const da = new Float64Array(n);
  const db = new Float64Array(n);
  const daa = new Float64Array(n);
  const dbb = new Float64Array(n);
  const dab = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    da[i] = a[i] - ma;
    db[i] = b[i] - mb;
    daa[i] = da[i] * da[i];
    dbb[i] = db[i] * db[i];
    dab[i] = da[i] * db[i];
  }
  const den = Math.sqrt(sum(daa) * sum(dbb));
  if (den < 1e-12) return 0;
  return sum(dab) / den;
}

// Precomputed DFT basis for WINDOW_SIZE.
const COS: Float64Array[] = [];
const SIN: Float64Array[] = [];
for (let k = 0; k <= WINDOW_SIZE / 2; k++) {
  const c = new Float64Array(WINDOW_SIZE);
  const s = new Float64Array(WINDOW_SIZE);
  for (let i = 0; i < WINDOW_SIZE; i++) {
    const ang = (2 * Math.PI * k * i) / WINDOW_SIZE;
    c[i] = Math.cos(ang);
    s[i] = Math.sin(ang);
  }
  COS.push(c);
  SIN.push(s);
}

function spectral(x: Float64Array, out: number[]): void {
  const n = x.length;
  const m = sum(x) / n;
  const xc = new Float64Array(n);
  for (let i = 0; i < n; i++) xc[i] = x[i] - m;
  let bestK = 1;
  let bestMag = -1;
  let weighted = 0;
  let total = 0;
  const tmp = new Float64Array(n);
  for (let k = 1; k <= n / 2; k++) {
    const c = COS[k];
    const s = SIN[k];
    for (let i = 0; i < n; i++) tmp[i] = xc[i] * c[i];
    const re = sum(tmp);
    for (let i = 0; i < n; i++) tmp[i] = xc[i] * s[i];
    const im = sum(tmp);
    const mag = Math.sqrt(re * re + im * im);
    if (mag > bestMag) {
      bestMag = mag;
      bestK = k;
    }
    const freq = (k * SAMPLE_RATE_HZ) / n;
    weighted += freq * mag;
    total += mag;
  }
  out.push((bestK * SAMPLE_RATE_HZ) / n, total > 1e-12 ? weighted / total : 0);
}

/** Extracts the 82 HAR features from one 6 x 128 window. */
export function extractFeatures(window: SensorWindow): number[] {
  if (window.length !== 6) throw new Error(`expected 6 channels, got ${window.length}`);
  for (const ch of window) {
    if (ch.length !== WINDOW_SIZE) throw new Error(`expected ${WINDOW_SIZE} samples, got ${ch.length}`);
  }
  const ch = window.map((c) => median3(c));
  const accMag = new Float64Array(WINDOW_SIZE);
  const gyroMag = new Float64Array(WINDOW_SIZE);
  for (let i = 0; i < WINDOW_SIZE; i++) {
    accMag[i] = Math.sqrt(ch[0][i] ** 2 + ch[1][i] ** 2 + ch[2][i] ** 2);
    gyroMag[i] = Math.sqrt(ch[3][i] ** 2 + ch[4][i] ** 2 + ch[5][i] ** 2);
  }
  const signals = [...ch, accMag, gyroMag];
  const feats: number[] = [];
  for (const s of signals) stats(s, feats);
  for (const [a, b] of CORR_PAIRS) feats.push(corr(ch[a], ch[b]));
  spectral(accMag, feats);
  spectral(gyroMag, feats);
  return feats;
}
