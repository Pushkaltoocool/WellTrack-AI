/**
 * Pure activity-tracking engine: turns classified windows into a smoothed activity
 * timeline and per-class duration totals. No React / sensor dependencies, so it is
 * shared by live tracking and recorded replay, and unit-tested directly.
 */
import { classifyWindow, type HarPrediction } from '@/services/ml/harModel';
import type { SixChannelWindow } from '@/services/sensors/windower';
import { emptyDurations, type ActivityClass, type ActivityDurations } from '@/types/domain';

export interface WindowResult {
  raw: HarPrediction;
  /** Majority vote over the last SMOOTHING_WINDOW raw predictions (or raw label if smoothing is off). */
  label: ActivityClass;
  attributedSeconds: number;
}

export const SMOOTHING_WINDOW = 3;

export interface EngineOptions {
  useGyro: boolean;
  smoothing: boolean;
  sampleRateHz?: number;
  windowSize?: number;
  step?: number;
}

export class ActivityEngine {
  readonly useGyro: boolean;
  readonly smoothing: boolean;
  private readonly windowSeconds: number;
  private readonly stepSeconds: number;
  private recent: ActivityClass[] = [];
  private segmentStart = true;

  durations: ActivityDurations = emptyDurations();
  windowCount = 0;
  current: WindowResult | null = null;
  /** Time spent continuously in the current smoothed label (seconds). */
  currentStreakSeconds = 0;

  constructor(opts: EngineOptions) {
    this.useGyro = opts.useGyro;
    this.smoothing = opts.smoothing;
    const rate = opts.sampleRateHz ?? 50;
    this.windowSeconds = (opts.windowSize ?? 128) / rate;
    this.stepSeconds = (opts.step ?? 64) / rate;
  }

  get trackedSeconds(): number {
    return Object.values(this.durations).reduce((a, b) => a + b, 0);
  }

  /** Call after a pause or sensor gap: the next window starts a new contiguous segment. */
  markSegmentBreak(): void {
    this.segmentStart = true;
    this.recent = [];
  }

  processWindow(window: SixChannelWindow): WindowResult {
    return this.processPrediction(classifyWindow(window, this.useGyro));
  }

  processPrediction(raw: HarPrediction): WindowResult {
    this.recent.push(raw.label);
    if (this.recent.length > SMOOTHING_WINDOW) this.recent.shift();
    const label = this.smoothing ? majority(this.recent) : raw.label;
    // The first window of a segment covers 2.56 s; each later window adds one 1.28 s hop.
    const attributedSeconds = this.segmentStart ? this.windowSeconds : this.stepSeconds;
    this.segmentStart = false;
    this.durations[label] += attributedSeconds;
    this.windowCount++;
    this.currentStreakSeconds =
      this.current && this.current.label === label ? this.currentStreakSeconds + attributedSeconds : attributedSeconds;
    this.current = { raw, label, attributedSeconds };
    return this.current;
  }
}

/** Most frequent label; ties resolved in favour of the most recent prediction. */
export function majority(labels: readonly ActivityClass[]): ActivityClass {
  const counts = new Map<ActivityClass, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  let best = labels[labels.length - 1];
  let bestCount = counts.get(best) ?? 0;
  for (const [l, c] of counts) {
    if (c > bestCount) {
      best = l;
      bestCount = c;
    }
  }
  return best;
}
