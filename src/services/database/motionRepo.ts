/** All-day activity caches: OS motion history and the Android background model (schema v6). */
import { todayKey } from '@/lib/dates';
import { emptyDurations, type ActivityDurations } from '@/types/domain';

import { transaction, type Db } from './db';

export const MOTION_TYPES = ['stationary', 'walking', 'running', 'automotive', 'cycling', 'unknown'] as const;
export type MotionKind = (typeof MOTION_TYPES)[number];
export type MotionMinutes = Record<MotionKind, number>;

export interface MotionDay {
  dateKey: string;
  source: string;
  minutes: MotionMinutes;
  syncedAt: number;
}

export interface BackgroundDay {
  dateKey: string;
  modelId: string;
  durations: ActivityDurations; // estimated seconds
  windowCount: number;
  updatedAt: number;
}

export const emptyMotionMinutes = (): MotionMinutes => ({ stationary: 0, walking: 0, running: 0, automotive: 0, cycling: 0, unknown: 0 });

export async function upsertMotionDays(db: Db, days: { dateKey: string; minutes: MotionMinutes }[], source: string): Promise<void> {
  if (!days.length) return;
  const now = Date.now();
  await transaction(db, async () => {
    for (const d of days) {
      await db.runAsync('INSERT OR REPLACE INTO motion_days (date_key, source, minutes_json, synced_at) VALUES (?, ?, ?, ?)',
        d.dateKey, source, JSON.stringify(d.minutes), now);
    }
  });
}

export async function listMotionDays(db: Db, fromKey: string, toKey: string = todayKey()): Promise<MotionDay[]> {
  const rows = await db.getAllAsync<{ date_key: string; source: string; minutes_json: string; synced_at: number }>(
    'SELECT * FROM motion_days WHERE date_key >= ? AND date_key <= ? ORDER BY date_key', fromKey, toKey);
  return rows.map((r) => ({ dateKey: r.date_key, source: r.source, minutes: { ...emptyMotionMinutes(), ...safeJson<Partial<MotionMinutes>>(r.minutes_json) }, syncedAt: r.synced_at }));
}

/** Adds estimated seconds to a day's background totals (chunks arrive in batches). */
export async function addBackgroundActivity(db: Db, dateKey: string, modelId: string, add: Partial<ActivityDurations>, windows: number): Promise<void> {
  await transaction(db, async () => {
    const row = await db.getFirstAsync<{ durations_json: string; window_count: number }>(
      'SELECT durations_json, window_count FROM background_activity WHERE date_key = ?', dateKey);
    const cur: ActivityDurations = { ...emptyDurations(), ...(row ? safeJson<Partial<ActivityDurations>>(row.durations_json) : {}) };
    for (const [k, v] of Object.entries(add)) cur[k as keyof ActivityDurations] += v ?? 0;
    await db.runAsync('INSERT OR REPLACE INTO background_activity (date_key, model_id, durations_json, window_count, updated_at) VALUES (?, ?, ?, ?, ?)',
      dateKey, modelId, JSON.stringify(cur), (row?.window_count ?? 0) + windows, Date.now());
  });
}

export async function listBackgroundDays(db: Db, fromKey: string, toKey: string = todayKey()): Promise<BackgroundDay[]> {
  const rows = await db.getAllAsync<{ date_key: string; model_id: string; durations_json: string; window_count: number; updated_at: number }>(
    'SELECT * FROM background_activity WHERE date_key >= ? AND date_key <= ? ORDER BY date_key', fromKey, toKey);
  return rows.map((r) => ({ dateKey: r.date_key, modelId: r.model_id, durations: { ...emptyDurations(), ...safeJson<Partial<ActivityDurations>>(r.durations_json) }, windowCount: r.window_count, updatedAt: r.updated_at }));
}

function safeJson<T>(s: string): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return {} as T;
  }
}
