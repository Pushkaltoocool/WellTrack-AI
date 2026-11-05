import { describe, expect, it } from '@jest/globals';
import fixtures from './fixtures/har_fixtures.json';
import replay from '../src/assets/replay/har_replay.json';
import { orientationCheck } from '@/features/activity/orientation';
import { ActivityEngine, majority } from '@/features/activity/trackingEngine';
import { extractFeatures } from '@/services/ml/harFeatures';
import { SensorWindower } from '@/services/sensors/windower';

function feed(w: SensorWindower, samples: number[][], t0 = 1000, rate = 50, gyroOffset = 0) {
  const out: Float64Array[][] = [];
  const n = samples[0].length;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / rate;
    out.push(...w.pushAccelerometer({ t, x: samples[0][i], y: samples[1][i], z: samples[2][i] }));
    out.push(...w.pushGyroscope({ t: t + gyroOffset, x: samples[3][i], y: samples[4][i], z: samples[5][i] }));
  }
  return out;
}

describe('SensorWindower', () => {
  it('reproduces original windows exactly from a perfectly timed 50 Hz stream', () => {
    const w = new SensorWindower();
    const win = (fixtures as { cases: { window: number[][] }[] }).cases[0].window;
    const out = feed(w, win);
    expect(out).toHaveLength(1);
    out[0].forEach((ch, c) => ch.forEach((v, i) => expect(v).toBeCloseTo(win[c][i], 12)));
  });

  it('emits windows every 64 samples (50% overlap)', () => {
    const w = new SensorWindower();
    const seq = (replay as { sequences: { samples: number[][] }[] }).sequences[0].samples;
    const out = feed(w, seq);
    const n = seq[0].length;
    expect(out).toHaveLength(Math.floor((n - 128) / 64) + 1);
    // second window starts 64 samples in
    expect(out[1][0][0]).toBeCloseTo(seq[0][64], 12);
  });

  it('resamples asynchronous, jittered streams onto the 50 Hz grid', () => {
    const w = new SensorWindower();
    const out: Float64Array[][] = [];
    // accelerometer at ~100 Hz with jitter, gyroscope at ~60 Hz offset in time
    for (let i = 0; i < 400; i++) {
      const t = 5 + i * 0.01 + (i % 3) * 0.001;
      out.push(...w.pushAccelerometer({ t, x: t, y: 2 * t, z: 1 }));
      if (i % 2 === 0) {
        const tg = 5.003 + i * 0.0083;
        out.push(...w.pushGyroscope({ t: tg, x: 0.1, y: 0, z: tg }));
      }
    }
    expect(out.length).toBeGreaterThanOrEqual(1);
    const first = out[0];
    // x = t is linear, so interpolated values must be exactly evenly spaced by 1/50 s
    for (let i = 1; i < 128; i++) expect(first[0][i] - first[0][i - 1]).toBeCloseTo(0.02, 9);
    for (let i = 1; i < 128; i++) expect(first[5][i] - first[5][i - 1]).toBeCloseTo(0.02, 9);
  });

  it('resets instead of interpolating across a sensor gap', () => {
    const w = new SensorWindower();
    for (let i = 0; i < 100; i++) w.pushAccelerometer({ t: i / 50, x: 0, y: 0, z: 1 });
    for (let i = 0; i < 100; i++) w.pushGyroscope({ t: i / 50, x: 0, y: 0, z: 0 });
    expect(w.buffered).toBeGreaterThan(90);
    w.pushAccelerometer({ t: 10, x: 0, y: 0, z: 1 }); // 8 s gap
    expect(w.resetCount).toBe(1);
    expect(w.buffered).toBe(0);
  });

  it('works without a gyroscope when configured accelerometer-only', () => {
    const w = new SensorWindower({ useGyro: false });
    const out: Float64Array[][] = [];
    for (let i = 0; i < 128; i++) out.push(...w.pushAccelerometer({ t: i / 50, x: 1, y: 0, z: 0 }));
    expect(out).toHaveLength(1);
    expect(Array.from(out[0][3]).every((v) => v === 0)).toBe(true);
    expect(extractFeatures(out[0])).toHaveLength(82);
  });
});

describe('ActivityEngine', () => {
  it('majority vote prefers the most recent label on ties', () => {
    expect(majority(['SITTING', 'STANDING'])).toBe('STANDING');
    expect(majority(['SITTING', 'STANDING', 'SITTING'])).toBe('SITTING');
  });

  it('classifies replayed held-out sequences and attributes durations', () => {
    const seqs = (replay as { sequences: { label: string; samples: number[][] }[] }).sequences;
    let correctSeq = 0;
    for (const s of seqs) {
      const engine = new ActivityEngine({ useGyro: true, smoothing: true });
      const w = new SensorWindower();
      for (const win of feed(w, s.samples)) engine.processWindow(win);
      const n = s.samples[0].length;
      const expectedWindows = Math.floor((n - 128) / 64) + 1;
      expect(engine.windowCount).toBe(expectedWindows);
      // first window 2.56 s + 1.28 s per later window
      expect(engine.trackedSeconds).toBeCloseTo(2.56 + (expectedWindows - 1) * 1.28, 6);
      const top = Object.entries(engine.durations).sort((a, b) => b[1] - a[1])[0][0];
      if (top === s.label) correctSeq++;
    }
    // held-out data: most sequences' dominant prediction should match the true label
    expect(correctSeq / seqs.length).toBeGreaterThanOrEqual(0.75);
  });
});

describe('orientationCheck', () => {
  it('accepts the UCI upright placement (gravity along +X)', () => {
    expect(orientationCheck({ x: 0.98, y: -0.15, z: -0.05 })?.matchesTraining).toBe(true);
  });
  it('warns for a phone upright in portrait (gravity along Y)', () => {
    const r = orientationCheck({ x: 0.02, y: 0.99, z: 0.1 });
    expect(r?.matchesTraining).toBe(false);
    expect(r?.dominantAxis).toBe('y');
  });
  it('returns null without enough signal', () => {
    expect(orientationCheck({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});
