import { describe, expect, it } from '@jest/globals';

import {
  combineCsv,
  CSV_HEADER,
  emptyBuffer,
  recordingId,
  recordingToCsv,
  segmentCount,
  trimEnd,
  type RecordingMeta,
  type SampleBuffer,
} from '@/features/activity/harRecordingFormat';
import { SensorWindower } from '@/services/sensors/windower';

function buffer(n: number, segments: (i: number) => number = () => 0): SampleBuffer {
  const b = emptyBuffer();
  for (let i = 0; i < n; i++) {
    b.t.push(i / 50);
    b.segment.push(segments(i));
    for (let c = 0; c < 6; c++) b.ch[c].push(c + i / 1000);
  }
  return b;
}

const meta = (over: Partial<RecordingMeta> = {}): RecordingMeta => ({
  id: 'rec1',
  label: 'WALKING',
  placement: 'pocket',
  platform: 'android',
  device: 'Pixel, 8 "Pro"',
  osVersion: '16',
  appVersion: '1.0.0',
  startedAt: 0,
  durationSeconds: 1,
  sampleCount: 3,
  segments: 1,
  useGyro: true,
  meanAccRateHz: 50,
  meanGyroRateHz: 50,
  stoppedBy: 'timer',
  trimmedEndSeconds: 0,
  ...over,
});

describe('HAR recording format', () => {
  it('builds readable ids from local time, label and placement', () => {
    const at = new Date(2026, 10, 3, 14, 2, 33).getTime();
    expect(recordingId(at, 'WALKING_UPSTAIRS', 'pocket')).toBe('20261103-140233-walkingupstairs-pocket');
  });

  it('trims the requested seconds from the end only', () => {
    const b = buffer(500); // 0 … 9.98 s
    const out = trimEnd(b, 3);
    expect(out.t[out.t.length - 1]).toBeCloseTo(6.98, 9);
    expect(out.t[0]).toBe(0);
    out.ch.forEach((c) => expect(c).toHaveLength(out.t.length));
    expect(trimEnd(b, 0)).toBe(b);
    expect(trimEnd(b, 60).t).toHaveLength(0);
  });

  it('writes one row per sample with a sanitised device and labelled columns', () => {
    const csv = recordingToCsv(meta(), buffer(3));
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(4);
    const cols = lines[1].split(',');
    expect(cols).toHaveLength(CSV_HEADER.split(',').length);
    expect(cols.slice(0, 7)).toEqual(['rec1', 'WALKING', 'pocket', 'android', 'Pixel 8 Pro', '0', '0.000']);
    expect(Number(cols[7])).toBeCloseTo(0, 5);
    expect(Number(cols[12])).toBeCloseTo(5, 5);
  });

  it('leaves gyro columns empty when no gyroscope was used', () => {
    const row = recordingToCsv(meta({ useGyro: false }), buffer(1)).split('\n')[1];
    expect(row.split(',')).toHaveLength(13);
    expect(row.split(',').slice(10)).toEqual(['', '', '']);
  });

  it('combines recordings under a single header', () => {
    const a = recordingToCsv(meta({ id: 'a' }), buffer(2));
    const b = recordingToCsv(meta({ id: 'b' }), buffer(3));
    const lines = combineCsv([a, b]).trimEnd().split('\n');
    expect(lines.filter((l) => l === CSV_HEADER)).toHaveLength(1);
    expect(lines).toHaveLength(6);
    expect(lines[3].startsWith('b,')).toBe(true);
  });

  it('counts distinct segments', () => {
    expect(segmentCount(buffer(10, (i) => (i < 5 ? 0 : 1)))).toBe(2);
  });
});

describe('SensorWindower as a 50 Hz resampler (recording mode)', () => {
  it('emits every grid sample once, with times recoverable from nextGridTime', () => {
    const w = new SensorWindower({ windowSize: 1, step: 1 });
    const times: number[] = [];
    const collect = (out: Float64Array[][]) => {
      const next = w.nextGridTime ?? 0;
      out.forEach((s, k) => {
        expect(s[0]).toHaveLength(1);
        times.push(next - (out.length - k) / 50);
        expect(s[0][0]).toBeCloseTo(times[times.length - 1], 9); // acc_x = t, so linear interpolation is exact
      });
    };
    // ~40 Hz jittered input, gyro slightly offset
    for (let i = 0; i < 200; i++) {
      const t = 100 + i * 0.025 + (i % 3) * 0.002;
      collect(w.pushAccelerometer({ t, x: t, y: 0, z: 0 }));
      collect(w.pushGyroscope({ t: t + 0.004, x: 0, y: 0, z: 0 }));
    }
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.02, 9);
    expect(times.length).toBeGreaterThan(240);
  });

  it('reports a reset after a sensor gap so the recorder can start a new segment', () => {
    const w = new SensorWindower({ windowSize: 1, step: 1, useGyro: false });
    for (let i = 0; i < 10; i++) w.pushAccelerometer({ t: i / 50, x: 0, y: 0, z: 1 });
    expect(w.resetCount).toBe(0);
    w.pushAccelerometer({ t: 2, x: 0, y: 0, z: 1 });
    expect(w.resetCount).toBe(1);
  });
});
