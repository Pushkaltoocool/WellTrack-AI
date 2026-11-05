/**
 * Apple HealthKit access (read-only). The native module is loaded lazily and only on iOS builds
 * that are NOT Expo Go — Expo Go does not ship HealthKit, so everything here is inert there and on
 * Android / web.
 */
import type * as HealthKitModule from '@kingstinct/react-native-healthkit';
import { isRunningInExpoGo } from 'expo';
import { Platform, TurboModuleRegistry } from 'react-native';

import { dateKey } from '@/lib/dates';

import { bucketMinutesByDay, buildDailyRows, rangeBounds, sleepByNight, type DayValues } from './aggregate';
import type { DailyHealth, HealthAvailability, SleepSample } from './types';

type HK = typeof HealthKitModule;
type ReadType =
  | 'HKCategoryTypeIdentifierSleepAnalysis'
  | 'HKCategoryTypeIdentifierMindfulSession'
  | 'HKQuantityTypeIdentifierStepCount'
  | 'HKQuantityTypeIdentifierActiveEnergyBurned'
  | 'HKQuantityTypeIdentifierTimeInDaylight';

let hk: HK | null | undefined;

function iosMajorVersion(): number {
  return Platform.OS === 'ios' ? Number.parseInt(String(Platform.Version), 10) || 0 : 0;
}

function healthKitModule(): HK | null {
  if (hk !== undefined) return hk;
  hk = null;
  if (Platform.OS !== 'ios' || isRunningInExpoGo()) return null;
  // The library runs on Nitro; if this binary was built without it, don't even evaluate the JS.
  if (TurboModuleRegistry.get('NitroModules') == null) return null;
  try {
    // Lazy so Expo Go / Android never evaluate the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hk = require('@kingstinct/react-native-healthkit') as HK;
  } catch (e) {
    console.warn('[health] HealthKit module failed to load', e);
    hk = null;
  }
  return hk;
}

export function healthAvailability(): HealthAvailability {
  if (Platform.OS !== 'ios') return 'unsupported-platform';
  if (isRunningInExpoGo()) return 'expo-go';
  const m = healthKitModule();
  if (!m) return 'unavailable';
  try {
    return m.isHealthDataAvailable() ? 'available' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Time in daylight is iOS 17+; requesting or querying it on older iOS would fail. */
function readTypes(): ReadType[] {
  const types: ReadType[] = [
    'HKCategoryTypeIdentifierSleepAnalysis',
    'HKQuantityTypeIdentifierStepCount',
    'HKQuantityTypeIdentifierActiveEnergyBurned',
    'HKCategoryTypeIdentifierMindfulSession',
  ];
  if (iosMajorVersion() >= 17) types.push('HKQuantityTypeIdentifierTimeInDaylight');
  return types;
}

/**
 * Shows the Health permission sheet (read-only). Resolves true when the request completed — iOS
 * never reveals whether read access was actually granted; denied types simply return no data.
 */
export async function requestHealthAuthorization(): Promise<boolean> {
  const m = healthKitModule();
  if (!m || healthAvailability() !== 'available') return false;
  return m.requestAuthorization({ toRead: readTypes() });
}

/** True once the permission sheet has been shown for every type we read (whatever the user chose). */
export async function healthAuthorizationRequested(): Promise<boolean> {
  const m = healthKitModule();
  if (!m || healthAvailability() !== 'available') return false;
  const status = await m.getRequestStatusForAuthorization({ toRead: readTypes() });
  return status === m.AuthorizationRequestStatus.unnecessary;
}

async function dailySum(
  m: HK,
  identifier:
    | 'HKQuantityTypeIdentifierStepCount'
    | 'HKQuantityTypeIdentifierActiveEnergyBurned'
    | 'HKQuantityTypeIdentifierTimeInDaylight',
  unit: 'count' | 'kcal' | 'min',
  start: Date,
  end: Date,
): Promise<DayValues> {
  // A statistics collection query de-duplicates overlapping iPhone + Apple Watch samples, like Health does.
  const stats = await m.queryStatisticsCollectionForQuantity(identifier, ['cumulativeSum'], start, { day: 1 }, {
    filter: { date: { startDate: start, endDate: end } },
    unit,
  });
  const out: DayValues = {};
  for (const s of stats) {
    if (!s.startDate || s.sumQuantity == null) continue;
    const key = dateKey(s.startDate);
    out[key] = (out[key] ?? 0) + s.sumQuantity.quantity;
  }
  return out;
}

async function sleepValues(m: HK, start: Date, end: Date): Promise<{ asleep: DayValues; inBed: DayValues }> {
  // Start a day early so a night that ends on the first morning of the range is complete.
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  const samples = await m.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 0,
    ascending: true,
    filter: { date: { startDate: from, endDate: end } },
  });
  const mapped: SleepSample[] = samples.map((s) => ({
    start: new Date(s.startDate),
    end: new Date(s.endDate),
    value: Number(s.value),
    source: s.sourceRevision?.source?.bundleIdentifier,
  }));
  return sleepByNight(mapped);
}

async function mindfulValues(m: HK, start: Date, end: Date): Promise<DayValues> {
  const samples = await m.queryCategorySamples('HKCategoryTypeIdentifierMindfulSession', {
    limit: 0,
    ascending: true,
    filter: { date: { startDate: start, endDate: end } },
  });
  return bucketMinutesByDay(samples.map((s) => ({ start: new Date(s.startDate), end: new Date(s.endDate) })));
}

/** Runs one metric's query; a failure only nulls that metric. */
async function settle<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    console.warn(`[health] ${label} query failed`, e);
    return null;
  }
}

/**
 * One row per local day from `fromKey` to `toKey` (inclusive, YYYY-MM-DD). Fields are null when
 * there is no data (or that metric's query failed). Call `requestHealthAuthorization()` first —
 * HealthKit can crash the app when querying a type whose permission was never requested, so this
 * throws instead of querying when the permission sheet hasn't been shown yet.
 */
export async function readDailyHealth(fromKey: string, toKey: string): Promise<DailyHealth[]> {
  const m = healthKitModule();
  if (!m || healthAvailability() !== 'available') return buildDailyRows(fromKey, toKey, {});
  if (!(await healthAuthorizationRequested())) {
    throw new Error('Connect Apple Health to see this data.');
  }
  const { start, end } = rangeBounds(fromKey, toKey);
  const [sleep, steps, energy, mindful, daylight] = await Promise.all([
    settle('sleep', () => sleepValues(m, start, end)),
    settle('steps', () => dailySum(m, 'HKQuantityTypeIdentifierStepCount', 'count', start, end)),
    settle('activeEnergy', () => dailySum(m, 'HKQuantityTypeIdentifierActiveEnergyBurned', 'kcal', start, end)),
    settle('mindful', () => mindfulValues(m, start, end)),
    iosMajorVersion() >= 17
      ? settle('daylight', () => dailySum(m, 'HKQuantityTypeIdentifierTimeInDaylight', 'min', start, end))
      : Promise.resolve(null),
  ]);
  return buildDailyRows(fromKey, toKey, {
    asleepMinutes: sleep?.asleep ?? null,
    inBedMinutes: sleep?.inBed ?? null,
    steps,
    activeEnergyKcal: energy,
    mindfulMinutes: mindful,
    daylightMinutes: daylight,
  });
}
