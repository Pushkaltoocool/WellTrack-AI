import { describe, expect, it, jest } from '@jest/globals';

const mockHealthKitLoads = { count: 0 };

// If anything evaluates the HealthKit library in Jest, this factory runs and the test below fails.
jest.mock('@kingstinct/react-native-healthkit', () => {
  mockHealthKitLoads.count++;
  return { isHealthDataAvailable: () => true };
});

// eslint-disable-next-line import/first
import {
  averageOf,
  bucketMinutesByDay,
  buildDailyRows,
  dateKeysInRange,
  healthAvailability,
  mergeIntervals,
  monthlyAverages,
  sleepByNight,
  type DailyHealth,
  type SleepSample,
} from '@/features/health';

// Local-time helper (January avoids DST transitions whatever the machine's time zone).
const at = (day: number, h: number, m = 0, month = 0, year = 2026) => new Date(year, month, day, h, m);

const IN_BED = 0;
const ASLEEP = 1;
const AWAKE = 2;
const CORE = 3;
const DEEP = 4;
const REM = 5;

function s(start: Date, end: Date, value: number, source = 'com.apple.health.watch'): SleepSample {
  return { start, end, value, source };
}

describe('mergeIntervals', () => {
  it('unions overlapping and touching intervals, drops empty ones', () => {
    const merged = mergeIntervals([
      { start: at(10, 1), end: at(10, 3) },
      { start: at(10, 2), end: at(10, 4) },
      { start: at(10, 4), end: at(10, 5) },
      { start: at(10, 8), end: at(10, 8) },
      { start: at(10, 6), end: at(10, 7) },
    ]);
    expect(merged.map((i) => [i.start.getHours(), i.end.getHours()])).toEqual([
      [1, 5],
      [6, 7],
    ]);
  });
});

describe('sleepByNight', () => {
  it('never double counts overlapping Watch and iPhone asleep samples', () => {
    const { asleep } = sleepByNight([
      s(at(9, 23), at(10, 6), ASLEEP, 'com.apple.health.phone'),
      s(at(10, 1), at(10, 7), ASLEEP, 'com.apple.health.watch'),
    ]);
    expect(asleep['2026-01-10']).toBe(8 * 60); // 23:00–07:00, not 7h + 6h
  });

  it('prefers stage-recording sources so a coarse block cannot hide Watch-detected awake time', () => {
    const { asleep } = sleepByNight([
      s(at(9, 23), at(10, 1), CORE),
      s(at(10, 1), at(10, 2), DEEP),
      s(at(10, 2), at(10, 3), REM),
      s(at(10, 3), at(10, 3, 15), AWAKE),
      s(at(10, 3, 15), at(10, 7), CORE),
      s(at(9, 23, 30), at(10, 6, 30), ASLEEP, 'com.thirdparty.sleep'),
    ]);
    expect(asleep['2026-01-10']).toBe(8 * 60 - 15);
  });

  it('separates inBed from asleep stages and ignores awake', () => {
    const { asleep, inBed } = sleepByNight([
      s(at(9, 22, 30), at(10, 7, 15), IN_BED, 'com.apple.health.phone'),
      s(at(9, 23), at(10, 3), CORE),
      s(at(10, 3), at(10, 3, 30), AWAKE),
      s(at(10, 3, 30), at(10, 7), REM),
    ]);
    expect(asleep['2026-01-10']).toBe(7.5 * 60);
    expect(inBed['2026-01-10']).toBe(8 * 60 + 45);
    expect(asleep['2026-01-09']).toBeUndefined();
  });

  it('attributes a night that crosses midnight to the wake-up date, keeping mid-night wake gaps in one night', () => {
    const { asleep } = sleepByNight([
      s(at(14, 22), at(15, 0, 30), ASLEEP),
      s(at(15, 1, 30), at(15, 6), ASLEEP), // woke for an hour at 00:30
      s(at(15, 14), at(15, 14, 30), ASLEEP), // afternoon nap: separate session, same wake date
    ]);
    expect(Object.keys(asleep)).toEqual(['2026-01-15']);
    expect(asleep['2026-01-15']).toBe(2.5 * 60 + 4.5 * 60 + 30);
  });

  it('attributes a night that ends before midnight to that evening', () => {
    const { asleep } = sleepByNight([s(at(20, 21), at(20, 23, 30), ASLEEP)]);
    expect(asleep).toEqual({ '2026-01-20': 150 });
  });
});

describe('bucketMinutesByDay', () => {
  it('splits intervals at local midnight', () => {
    expect(bucketMinutesByDay([{ start: at(9, 23, 50), end: at(10, 0, 20) }])).toEqual({
      '2026-01-09': 10,
      '2026-01-10': 20,
    });
  });

  it('merges duplicates from several apps before summing', () => {
    expect(
      bucketMinutesByDay([
        { start: at(9, 8), end: at(9, 8, 10) },
        { start: at(9, 8, 5), end: at(9, 8, 15) },
        { start: at(9, 20), end: at(9, 20, 5) },
      ]),
    ).toEqual({ '2026-01-09': 20 });
  });

  it('handles an interval spanning several days', () => {
    expect(bucketMinutesByDay([{ start: at(1, 12), end: at(3, 6) }])).toEqual({
      '2026-01-01': 720,
      '2026-01-02': 1440,
      '2026-01-03': 360,
    });
  });
});

describe('daily rows', () => {
  it('lists inclusive local date keys across a month boundary', () => {
    expect(dateKeysInRange('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);
    expect(dateKeysInRange('2026-02-02', '2026-01-30')).toEqual([]);
  });

  it('fills missing days and failed metrics with null', () => {
    const rows = buildDailyRows('2026-01-01', '2026-01-02', {
      steps: { '2026-01-01': 4200, '2025-12-31': 99 },
      activeEnergyKcal: null,
    });
    expect(rows).toEqual([
      { dateKey: '2026-01-01', asleepMinutes: null, inBedMinutes: null, steps: 4200, activeEnergyKcal: null, mindfulMinutes: null, daylightMinutes: null },
      { dateKey: '2026-01-02', asleepMinutes: null, inBedMinutes: null, steps: null, activeEnergyKcal: null, mindfulMinutes: null, daylightMinutes: null },
    ]);
  });
});

describe('averages', () => {
  const row = (dateKey: string, steps: number | null, asleepMinutes: number | null = null): DailyHealth => ({
    dateKey,
    asleepMinutes,
    inBedMinutes: null,
    steps,
    activeEnergyKcal: null,
    mindfulMinutes: null,
    daylightMinutes: null,
  });
  const rows = [
    row('2026-01-01', 1000, 420),
    row('2026-01-02', null),
    row('2026-01-03', 3000, 480),
    row('2026-03-10', null),
    row('2026-12-31', 0),
    row('2025-01-15', 50_000),
    row('2027-01-01', 50_000),
  ];

  it('monthlyAverages averages only days with data and is null for empty months', () => {
    const steps = monthlyAverages(rows, 2026, 'steps');
    expect(steps).toHaveLength(12);
    expect(steps[0]).toBe(2000);
    expect(steps[1]).toBeNull();
    expect(steps[2]).toBeNull(); // a row exists but has no steps
    expect(steps[11]).toBe(0); // zero is data
    expect(monthlyAverages(rows, 2026, 'sleep')[0]).toBe(450);
  });

  it('averageOf ignores days without data', () => {
    expect(averageOf(rows.slice(0, 3), 'steps')).toBe(2000);
    expect(averageOf([row('2026-01-02', null)], 'steps')).toBeNull();
    expect(averageOf([], 'mindful')).toBeNull();
  });
});

describe('healthAvailability', () => {
  it('is not available in Jest and never loads the HealthKit module', () => {
    expect(healthAvailability()).not.toBe('available');
    expect(mockHealthKitLoads.count).toBe(0);
  });
});
