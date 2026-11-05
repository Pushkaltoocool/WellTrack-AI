/**
 * All-day step history from the OS pedometer. Only iOS exposes historical step counts in
 * Expo Go (Core Motion via Pedometer.getStepCountAsync, last 7 days); Android has no
 * equivalent without Health Connect, which needs a development build.
 *
 * Synced day totals are stored in `daily_steps`, so history keeps growing past the
 * 7-day OS window as long as the app is opened at least once a week.
 */
import { Pedometer } from 'expo-sensors';
import { Platform } from 'react-native';

import { dateKey } from '@/lib/dates';
import type { Db } from '@/services/database/db';
import { upsertDailySteps } from '@/services/database/repositories';

export const STEP_HISTORY_SUPPORTED = Platform.OS === 'ios';
export const STEP_HISTORY_SOURCE = 'ios-core-motion';
/** Core Motion keeps 7 days: today plus the 6 previous calendar days fit inside it. */
export const STEP_HISTORY_DAYS = 7;

export type StepHistoryStatus = 'synced' | 'unsupported' | 'disabled' | 'unavailable' | 'denied' | 'error';

export interface DayRange {
  dateKey: string;
  start: Date;
  end: Date;
}

/** Local-midnight ranges for the last `days` calendar days, oldest first; today ends at `now`. */
export function stepHistoryRanges(now: Date, days: number = STEP_HISTORY_DAYS): DayRange[] {
  const out: DayRange[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
    out.push({ dateKey: dateKey(start), start, end: i === 0 ? now : nextMidnight });
  }
  return out;
}

const MIN_SYNC_INTERVAL_MS = 60_000;
let lastSyncAt = 0;
let inFlight: Promise<StepHistoryStatus> | null = null;

/** Asks for Motion & Fitness access (iOS shows the system prompt once). */
export async function requestStepHistoryPermission(): Promise<boolean> {
  if (!STEP_HISTORY_SUPPORTED) return false;
  try {
    const res = await Pedometer.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/**
 * Reads the last 7 days from Core Motion and stores the totals. Throttled to once a minute
 * unless `force` is set; concurrent callers share one sync.
 */
export function syncStepHistory(db: Db, enabled: boolean, opts: { force?: boolean; now?: Date } = {}): Promise<StepHistoryStatus> {
  if (!STEP_HISTORY_SUPPORTED) return Promise.resolve('unsupported');
  if (!enabled) return Promise.resolve('disabled');
  if (inFlight) return inFlight;
  if (!opts.force && Date.now() - lastSyncAt < MIN_SYNC_INTERVAL_MS) return Promise.resolve('synced');
  inFlight = (async (): Promise<StepHistoryStatus> => {
    try {
      if (!(await Pedometer.isAvailableAsync())) return 'unavailable';
      const perm = await Pedometer.getPermissionsAsync();
      if (!perm.granted) return 'denied';
      const ranges = stepHistoryRanges(opts.now ?? new Date());
      const rows = [];
      for (const r of ranges) {
        const res = await Pedometer.getStepCountAsync(r.start, r.end);
        rows.push({ dateKey: r.dateKey, steps: res.steps });
      }
      await upsertDailySteps(db, rows, STEP_HISTORY_SOURCE);
      lastSyncAt = Date.now();
      return 'synced';
    } catch (e) {
      console.warn('[stepHistory]', e);
      return 'error';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
