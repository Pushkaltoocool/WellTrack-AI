import { addDays, parseDateKey } from './dates';

/**
 * Consecutive days, ending today, with at least one entry. If today has nothing yet the streak
 * still counts from yesterday, so it doesn't reset in the morning before you've checked in.
 */
export function dayStreak(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

/** The Sunday-to-Saturday week containing `key`. */
export function weekOf(key: string): string[] {
  const start = addDays(key, -parseDateKey(key).getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
