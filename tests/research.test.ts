import { describe, expect, it } from '@jest/globals';
import { csvToBuffer, recordingToCsv, type RecordingMeta } from '@/features/activity/harRecordingFormat';
import { MIN_DAYS, stressVsActivity } from '@/features/research/stressSignals';

describe('stressVsActivity', () => {
  it('needs enough days before saying anything', () => {
    const s = stressVsActivity(Array.from({ length: MIN_DAYS - 1 }, (_, i) => ({ stressLevel: 3, activeMinutes: i * 10 })));
    expect(s.sentence).toBeNull();
    expect(s.days).toBe(MIN_DAYS - 1);
  });

  it('ignores days missing either value', () => {
    expect(stressVsActivity([{ stressLevel: null, activeMinutes: 40 }, { stressLevel: 3, activeMinutes: null }]).days).toBe(0);
  });

  it('reports lower stress on more active days', () => {
    const rows = [10, 15, 20, 25, 50, 60, 70, 80].map((m) => ({ activeMinutes: m, stressLevel: m >= 50 ? 2 : 4 }));
    const s = stressVsActivity(rows);
    expect(s.sentence).toMatch(/lower on days you move 50\+ minutes/);
    expect(s.r).toBeLessThan(0);
  });

  it('says no clear difference when the groups match', () => {
    const rows = [10, 20, 30, 40, 50, 60, 70, 80].map((m) => ({ activeMinutes: m, stressLevel: 3 }));
    expect(stressVsActivity(rows).sentence).toMatch(/about the same/);
  });
});

describe('recording CSV round trip', () => {
  it('parses back what recordingToCsv wrote', () => {
    const meta = { id: 'r1', label: 'RUNNING', placement: 'pocket', platform: 'ios', device: 'iPhone', useGyro: false } as RecordingMeta;
    const buf = { t: [0, 0.02, 0], segment: [0, 0, 1], ch: [[1, 2, 3], [0, 0, 0], [-1, -0.5, 0.25], [0, 0, 0], [0, 0, 0], [0, 0, 0]] };
    const back = csvToBuffer(recordingToCsv(meta, buf));
    expect(back.segment).toEqual([0, 0, 1]);
    expect(back.t).toEqual([0, 0.02, 0]);
    expect(back.ch[0]).toEqual([1, 2, 3]);
    expect(back.ch[2]).toEqual([-1, -0.5, 0.25]);
    expect(back.ch[3]).toEqual([0, 0, 0]); // no gyro → zeros
  });
});
