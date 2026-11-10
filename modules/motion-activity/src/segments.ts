import type { MotionActivitySample, MotionConfidence, RawMotionPoint } from './MotionActivity.types';

const CONFIDENCE_RANK: Record<MotionConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Each point lasts until the next point starts (the last one until `toMs`), clipped to
 * [fromMs, toMs]. Consecutive segments of the same type are merged, keeping the highest confidence.
 */
export function buildSegments(points: RawMotionPoint[], fromMs: number, toMs: number): MotionActivitySample[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: MotionActivitySample[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.type === 'gap') continue;
    const startMs = Math.max(p.t, fromMs);
    const endMs = Math.min(i + 1 < sorted.length ? sorted[i + 1].t : toMs, toMs);
    if (endMs <= startMs) continue;

    const prev = out[out.length - 1];
    if (prev && prev.type === p.type && prev.endMs === startMs) {
      prev.endMs = endMs;
      if (CONFIDENCE_RANK[p.confidence] > CONFIDENCE_RANK[prev.confidence]) prev.confidence = p.confidence;
    } else {
      out.push({ startMs, endMs, type: p.type, confidence: p.confidence });
    }
  }
  return out;
}
