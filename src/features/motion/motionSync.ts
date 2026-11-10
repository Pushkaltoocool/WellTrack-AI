/**
 * All-day activity without location:
 *  - OS motion history (iOS Core Motion keeps ~7 days; Android Activity Recognition transitions
 *    recorded by our native receiver) → minutes per type per local day in `motion_days`.
 *  - Android only: duty-cycled raw-sensor chunks captured by our foreground service, classified
 *    here with our own model → estimated seconds per class per day in `background_activity`.
 * Both run when the app opens or returns to the foreground (see useAllDaySync).
 */
import { Platform } from 'react-native';

import * as Motion from '../../../modules/motion-activity';
import type { MotionActivitySample, MotionPermission } from '../../../modules/motion-activity';
import { addDays, dateKey, todayKey } from '@/lib/dates';
import type { Db } from '@/services/database/db';
import { addBackgroundActivity, emptyMotionMinutes, upsertMotionDays, type MotionKind, type MotionMinutes } from '@/services/database/motionRepo';
import { classifyWindow, harModelFor } from '@/services/ml/harModel';
import { SensorWindower } from '@/services/sensors/windower';
import type { ActivityClass, ActivityDurations } from '@/types/domain';

export type { MotionActivitySample, MotionPermission };

/** Seconds between background captures; each captured chunk stands for one period. */
export const BACKGROUND_PERIOD_S = 120;
export const BACKGROUND_WINDOW_S = 10;
const HISTORY_DAYS = 7;

export const motionSupported = () => Motion.isNativeAvailable() && Motion.isActivityAvailable();
export const backgroundModelSupported = () => Platform.OS === 'android' && Motion.isSensorCaptureSupported();

export const motionPermission = (): Promise<MotionPermission> => (Motion.isNativeAvailable() ? Motion.getPermissionStatus() : Promise.resolve('unavailable'));

/** Asks for motion permission and starts OS updates (Android registers its receiver). */
export async function enableAllDay(): Promise<MotionPermission> {
  if (!motionSupported()) return 'unavailable';
  const status = await Motion.requestPermission();
  if (status === 'granted') await Motion.startActivityUpdates();
  return status;
}

export async function disableAllDay(): Promise<void> {
  if (Motion.isNativeAvailable()) await Motion.stopActivityUpdates();
}

export async function setBackgroundModel(on: boolean): Promise<boolean> {
  if (!backgroundModelSupported()) return false;
  if (!on) {
    await Motion.stopSensorCapture();
    return false;
  }
  return Motion.startSensorCapture({ windowSeconds: BACKGROUND_WINDOW_S, periodSeconds: BACKGROUND_PERIOD_S });
}

export const backgroundModelRunning = () => backgroundModelSupported() && Motion.isSensorCaptureRunning();

function startOfDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Splits segments at local midnight and sums minutes per type for each day. */
export function minutesByDay(samples: MotionActivitySample[]): Map<string, MotionMinutes> {
  const out = new Map<string, MotionMinutes>();
  for (const s of samples) {
    let t = s.startMs;
    while (t < s.endMs) {
      const key = dateKey(t);
      const dayEnd = startOfDay(addDays(key, 1));
      const end = Math.min(s.endMs, dayEnd);
      const day = out.get(key) ?? emptyMotionMinutes();
      day[s.type as MotionKind] += (end - t) / 60_000;
      out.set(key, day);
      t = end;
    }
  }
  return out;
}

/** Today's OS motion segments (for the timeline strip). */
export async function todaySegments(): Promise<MotionActivitySample[]> {
  if (!motionSupported()) return [];
  const start = startOfDay(todayKey());
  return Motion.queryActivities(start, Date.now()).catch(() => []);
}

export async function syncMotionHistory(db: Db): Promise<number> {
  if (!motionSupported() || (await Motion.getPermissionStatus()) !== 'granted') return 0;
  const from = startOfDay(addDays(todayKey(), -(HISTORY_DAYS - 1)));
  const samples = await Motion.queryActivities(from, Date.now());
  const days = [...minutesByDay(samples)].map(([dateKey, minutes]) => ({
    dateKey,
    minutes: Object.fromEntries(Object.entries(minutes).map(([k, v]) => [k, Math.round(v)])) as MotionMinutes,
  }));
  await upsertMotionDays(db, days, Platform.OS === 'ios' ? 'coremotion' : 'activity-recognition');
  return days.length;
}

/** Classifies captured background chunks with our own model, then deletes them. */
export async function processBackgroundChunks(db: Db): Promise<number> {
  if (!backgroundModelSupported()) return 0;
  let processed = 0;
  for (let batch = 0; batch < 20; batch++) {
    const chunks = await Motion.readCapturedChunks(50);
    if (!chunks.length) break;
    const perDay = new Map<string, { add: Partial<ActivityDurations>; windows: number; modelId: string }>();
    for (const c of chunks) {
      const useGyro = !!c.gyro && c.gyro.t.length > 0;
      const windower = new SensorWindower({ useGyro });
      const labels: ActivityClass[] = [];
      const classify = (ws: Float64Array[][]) => {
        for (const w of ws) {
          try {
            labels.push(classifyWindow(w, useGyro).label);
          } catch {
            // skip a malformed window
          }
        }
      };
      // Interleave by timestamp so the windower sees both sensors in time order.
      const acc = c.acc;
      const gyro = c.gyro;
      let gi = 0;
      for (let i = 0; i < acc.t.length; i++) {
        while (useGyro && gyro && gi < gyro.t.length && gyro.t[gi] <= acc.t[i]) {
          classify(windower.pushGyroscope({ t: gyro.t[gi], x: gyro.x[gi], y: gyro.y[gi], z: gyro.z[gi] }));
          gi++;
        }
        classify(windower.pushAccelerometer({ t: acc.t[i], x: acc.x[i], y: acc.y[i], z: acc.z[i] }));
      }
      if (labels.length) {
        // The chunk's majority label stands for the whole capture period.
        const counts = new Map<ActivityClass, number>();
        for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
        const top = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        const key = dateKey(c.startedAtMs);
        const day = perDay.get(key) ?? { add: {}, windows: 0, modelId: harModelFor(useGyro).modelId };
        day.add[top] = (day.add[top] ?? 0) + BACKGROUND_PERIOD_S;
        day.windows += labels.length;
        perDay.set(key, day);
      }
    }
    for (const [key, d] of perDay) await addBackgroundActivity(db, key, d.modelId, d.add, d.windows);
    await Motion.deleteCapturedChunks(chunks.map((c) => c.id));
    processed += chunks.length;
  }
  return processed;
}
