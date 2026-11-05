import { useCallback, useEffect, useState } from 'react';

import { healthAvailability, readDailyHealth, requestHealthAuthorization } from './healthKit';
import type { DailyHealth, HealthAvailability } from './types';

const EMPTY: DailyHealth[] = [];

export interface HealthData {
  availability: HealthAvailability;
  rows: DailyHealth[];
  loading: boolean;
  error: string | null;
  /** Shows the Health permission sheet, then reloads. Resolves false when HealthKit isn't available. */
  connect: () => Promise<boolean>;
  reload: () => void;
}

/**
 * Daily Apple Health rows for `fromKey`..`toKey` (inclusive local date keys). Reads nothing unless
 * `enabled` and HealthKit is available (iOS dev/store build) — in Expo Go, on Android and on web it
 * returns empty rows without loading the native module.
 */
export function useHealthData(fromKey: string, toKey: string, enabled: boolean): HealthData {
  const [availability] = useState(healthAvailability);
  const active = enabled && availability === 'available';

  const [rows, setRows] = useState<DailyHealth[]>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // `loading` is derived: true until the read for the current request key has settled.
  const requestKey = `${fromKey}:${toKey}:${tick}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    readDailyHealth(fromKey, toKey)
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [active, fromKey, toKey, requestKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const connect = useCallback(async () => {
    if (availability !== 'available') return false;
    const ok = await requestHealthAuthorization();
    setTick((t) => t + 1);
    return ok;
  }, [availability]);

  return {
    availability,
    rows: active ? rows : EMPTY,
    loading: active && settledKey !== requestKey,
    error: active ? error : null,
    connect,
    reload,
  };
}
