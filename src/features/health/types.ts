/** One row of Apple Health data for a local calendar day. `null` means "no data", never zero. */
export interface DailyHealth {
  /** Local calendar date, YYYY-MM-DD. */
  dateKey: string;
  asleepMinutes: number | null;
  inBedMinutes: number | null;
  steps: number | null;
  activeEnergyKcal: number | null;
  mindfulMinutes: number | null;
  daylightMinutes: number | null;
}

/**
 * - `available`: HealthKit can be queried (iOS dev/store build on a device with Health).
 * - `expo-go`: running inside Expo Go, which does not ship the HealthKit native module.
 * - `unsupported-platform`: Android / web.
 * - `unavailable`: iOS build without the native module, or a device without Health (e.g. iPad).
 */
export type HealthAvailability = 'available' | 'expo-go' | 'unsupported-platform' | 'unavailable';

export type HealthMetric = 'sleep' | 'steps' | 'activeEnergy' | 'mindful' | 'daylight';

/** A time interval. `end` is exclusive. */
export interface Interval {
  start: Date;
  end: Date;
}

/**
 * A raw sleep-analysis sample. `value` is the HealthKit HKCategoryValueSleepAnalysis raw value:
 * 0 inBed, 1 asleepUnspecified, 2 awake, 3 asleepCore, 4 asleepDeep, 5 asleepREM.
 */
export interface SleepSample extends Interval {
  value: number;
  /** Source identifier (e.g. bundle id) — used to prefer staged (Apple Watch style) sources. */
  source?: string;
}
