import { Platform } from 'react-native';

import type {
  CapturedChunk,
  KeepAlivePermission,
  MotionActivitySample,
  MotionPermission,
  RecordingKeepAliveOptions,
  SensorCaptureOptions,
} from './src/MotionActivity.types';
import Native from './src/MotionActivityModule';
import { buildSegments } from './src/segments';

export type {
  CapturedChunk,
  KeepAlivePermission,
  MotionActivitySample,
  MotionConfidence,
  MotionPermission,
  MotionType,
  RecordingKeepAliveOptions,
  SensorCaptureOptions,
  SensorSeries,
} from './src/MotionActivity.types';
export { buildSegments } from './src/segments';

export function isNativeAvailable(): boolean {
  return Native != null;
}

export function isActivityAvailable(): boolean {
  try {
    return Native?.isActivityAvailable() ?? false;
  } catch {
    return false;
  }
}

export async function getPermissionStatus(): Promise<MotionPermission> {
  if (!Native) return 'unavailable';
  try {
    return await Native.getPermissionStatus();
  } catch {
    return 'unavailable';
  }
}

export async function requestPermission(): Promise<MotionPermission> {
  if (!Native) return 'unavailable';
  try {
    return await Native.requestPermission();
  } catch {
    return 'unavailable';
  }
}

/** Activity segments overlapping [fromMs, toMs]. iOS keeps ~7 days of history. */
export async function queryActivities(fromMs: number, toMs: number): Promise<MotionActivitySample[]> {
  if (!Native || !(toMs > fromMs)) return [];
  const points = await Native.queryActivityPoints(fromMs, toMs);
  return buildSegments(points, fromMs, toMs);
}

export async function startActivityUpdates(): Promise<boolean> {
  if (!Native) return false;
  return Native.startActivityUpdates();
}

export async function stopActivityUpdates(): Promise<void> {
  if (!Native) return;
  await Native.stopActivityUpdates();
}

export function isSensorCaptureSupported(): boolean {
  return Platform.OS === 'android' && typeof Native?.startSensorCapture === 'function';
}

/** Android only. Needs ACTIVITY_RECOGNITION granted, and POST_NOTIFICATIONS on Android 13+ for the notification to show. */
export async function startSensorCapture(opts: SensorCaptureOptions = {}): Promise<boolean> {
  if (!isSensorCaptureSupported()) return false;
  const windowSeconds = Math.round(opts.windowSeconds ?? 10);
  const periodSeconds = Math.round(opts.periodSeconds ?? 120);
  return Native!.startSensorCapture!(windowSeconds, periodSeconds);
}

export async function stopSensorCapture(): Promise<void> {
  if (!isSensorCaptureSupported()) return;
  await Native!.stopSensorCapture!();
}

export function isSensorCaptureRunning(): boolean {
  if (!isSensorCaptureSupported()) return false;
  return Native!.isSensorCaptureRunning?.() ?? false;
}

/** Oldest first. Unparseable chunks are deleted so they can't clog the queue. */
export async function readCapturedChunks(limit: number): Promise<CapturedChunk[]> {
  if (!isSensorCaptureSupported() || !(limit > 0)) return [];
  const raw = await Native!.readCapturedChunks!(Math.floor(limit));
  const chunks: CapturedChunk[] = [];
  const corrupt: string[] = [];
  for (const { id, json } of raw) {
    try {
      chunks.push(JSON.parse(json) as CapturedChunk);
    } catch {
      corrupt.push(id);
    }
  }
  if (corrupt.length) await Native!.deleteCapturedChunks!(corrupt).catch(() => {});
  return chunks;
}

export async function deleteCapturedChunks(ids: string[]): Promise<void> {
  if (!isSensorCaptureSupported() || ids.length === 0) return;
  await Native!.deleteCapturedChunks!(ids);
}

/**
 * Starts keeping the app alive for a recording. iOS: location keep-alive (call while in the
 * foreground; needs location permission); Android: foreground service with a chronometer
 * notification (needs ACTIVITY_RECOGNITION on Android 14+, POST_NOTIFICATIONS to be visible).
 * Returns false if not possible (permission denied, unsupported, Expo Go/web).
 */
export async function startRecordingKeepAlive(opts: RecordingKeepAliveOptions): Promise<boolean> {
  if (typeof Native?.startRecordingKeepAlive !== 'function') return false;
  const startedAtMs = Number.isFinite(opts.startedAtMs) ? opts.startedAtMs : Date.now();
  try {
    return await Native.startRecordingKeepAlive(opts.title, opts.body, startedAtMs);
  } catch {
    return false;
  }
}

/** Android: updates the notification text. iOS: no-op. */
export async function updateRecordingKeepAlive(opts: { title: string; body: string }): Promise<void> {
  if (typeof Native?.updateRecordingKeepAlive !== 'function') return;
  try {
    await Native.updateRecordingKeepAlive(opts.title, opts.body);
  } catch {
    // Best effort.
  }
}

export async function stopRecordingKeepAlive(): Promise<void> {
  if (typeof Native?.stopRecordingKeepAlive !== 'function') return;
  try {
    await Native.stopRecordingKeepAlive();
  } catch {
    // Best effort.
  }
}

export function isRecordingKeepAliveActive(): boolean {
  try {
    return Native?.isRecordingKeepAliveActive?.() ?? false;
  } catch {
    return false;
  }
}

/** iOS: location authorization (when in use or always = granted). Android: 'granted'. */
export async function getKeepAlivePermission(): Promise<KeepAlivePermission> {
  if (typeof Native?.getKeepAlivePermission !== 'function') return 'unavailable';
  try {
    return await Native.getKeepAlivePermission();
  } catch {
    return 'unavailable';
  }
}

/** iOS: asks for when-in-use location and resolves once the user answers. Android: 'granted'. */
export async function requestKeepAlivePermission(): Promise<KeepAlivePermission> {
  if (typeof Native?.requestKeepAlivePermission !== 'function') return 'unavailable';
  try {
    return await Native.requestKeepAlivePermission();
  } catch {
    return 'unavailable';
  }
}
