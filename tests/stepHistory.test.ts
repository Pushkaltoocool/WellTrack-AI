import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockPedometer = {
  isAvailableAsync: jest.fn<() => Promise<boolean>>(),
  getPermissionsAsync: jest.fn<() => Promise<{ granted: boolean }>>(),
  requestPermissionsAsync: jest.fn<() => Promise<{ granted: boolean }>>(),
  getStepCountAsync: jest.fn<(start: Date, end: Date) => Promise<{ steps: number }>>(),
};
const mockUpsert = jest.fn<(db: unknown, rows: { dateKey: string; steps: number }[], source: string) => Promise<void>>();

// Imports are hoisted above these declarations, so the factories read the mocks lazily.
jest.mock('expo-sensors', () => ({
  get Pedometer() {
    return mockPedometer;
  },
}));
jest.mock('@/services/database/repositories', () => ({
  upsertDailySteps: (...args: Parameters<typeof mockUpsert>) => mockUpsert(...args),
}));

// eslint-disable-next-line import/first
import { STEP_HISTORY_SUPPORTED, stepHistoryRanges, syncStepHistory } from '@/features/activity/stepHistory';
// eslint-disable-next-line import/first
import type { Db } from '@/services/database/db';

const db = {} as Db;

describe('stepHistoryRanges', () => {
  const now = new Date(2026, 9, 30, 14, 25, 0); // 30 Oct 2026, 14:25 local

  it('covers today plus the 6 previous calendar days, oldest first', () => {
    const r = stepHistoryRanges(now);
    expect(r.map((x) => x.dateKey)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
  });

  it('uses contiguous local-midnight boundaries and ends today at now', () => {
    const r = stepHistoryRanges(now);
    for (let i = 0; i < r.length; i++) {
      expect(r[i].start.getHours()).toBe(0);
      expect(r[i].start.getMinutes()).toBe(0);
      if (i < r.length - 1) expect(r[i].end.getTime()).toBe(r[i + 1].start.getTime());
    }
    expect(r[r.length - 1].end).toBe(now);
  });

  it('stays inside the 7-day Core Motion window', () => {
    const r = stepHistoryRanges(now);
    expect(now.getTime() - r[0].start.getTime()).toBeLessThan(7 * 24 * 3600 * 1000);
  });

  it('crosses month boundaries', () => {
    const r = stepHistoryRanges(new Date(2026, 10, 2, 9, 0, 0), 4);
    expect(r.map((x) => x.dateKey)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('syncStepHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPedometer.isAvailableAsync.mockResolvedValue(true);
    mockPedometer.getPermissionsAsync.mockResolvedValue({ granted: true });
    mockPedometer.getStepCountAsync.mockImplementation(async (start) => ({ steps: start.getDate() * 100 }));
    mockUpsert.mockResolvedValue(undefined);
  });

  it('is supported on iOS (the jest-expo default platform)', () => {
    expect(STEP_HISTORY_SUPPORTED).toBe(true);
  });

  it('does nothing until the user opts in', async () => {
    expect(await syncStepHistory(db, false, { force: true })).toBe('disabled');
    expect(mockPedometer.getStepCountAsync).not.toHaveBeenCalled();
  });

  it('stores one total per day from Core Motion', async () => {
    const now = new Date(2026, 9, 30, 14, 25, 0);
    expect(await syncStepHistory(db, true, { force: true, now })).toBe('synced');
    expect(mockPedometer.getStepCountAsync).toHaveBeenCalledTimes(7);
    const [, rows, source] = mockUpsert.mock.calls[0];
    expect(source).toBe('ios-core-motion');
    expect(rows[0]).toEqual({ dateKey: '2026-10-24', steps: 2400 });
    expect(rows[6]).toEqual({ dateKey: '2026-10-30', steps: 3000 });
  });

  it('throttles repeated syncs unless forced', async () => {
    await syncStepHistory(db, true, { force: true });
    mockPedometer.getStepCountAsync.mockClear();
    expect(await syncStepHistory(db, true)).toBe('synced');
    expect(mockPedometer.getStepCountAsync).not.toHaveBeenCalled();
  });

  it('reports denied permission without reading or writing', async () => {
    mockPedometer.getPermissionsAsync.mockResolvedValue({ granted: false });
    expect(await syncStepHistory(db, true, { force: true })).toBe('denied');
    expect(mockPedometer.getStepCountAsync).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('reports an unavailable pedometer', async () => {
    mockPedometer.isAvailableAsync.mockResolvedValue(false);
    expect(await syncStepHistory(db, true, { force: true })).toBe('unavailable');
  });

  it('turns native errors into an error status instead of throwing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPedometer.getStepCountAsync.mockRejectedValue(new Error('boom'));
    expect(await syncStepHistory(db, true, { force: true })).toBe('error');
    expect(mockUpsert).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
