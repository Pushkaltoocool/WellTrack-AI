import { requireOptionalNativeModule } from 'expo';

import type { KeepAlivePermission, MotionPermission, RawMotionPoint } from './MotionActivity.types';

export interface NativeMotionActivityModule {
  isActivityAvailable(): boolean;
  getPermissionStatus(): Promise<MotionPermission>;
  requestPermission(): Promise<MotionPermission>;
  queryActivityPoints(fromMs: number, toMs: number): Promise<RawMotionPoint[]>;
  startActivityUpdates(): Promise<boolean>;
  stopActivityUpdates(): Promise<void>;
  // Android only.
  startSensorCapture?(windowSeconds: number, periodSeconds: number): Promise<boolean>;
  stopSensorCapture?(): Promise<void>;
  isSensorCaptureRunning?(): boolean;
  /** Raw chunk JSON, oldest first; parsed in JS (cheaper than bridging nested arrays). */
  readCapturedChunks?(limit: number): Promise<{ id: string; json: string }[]>;
  deleteCapturedChunks?(ids: string[]): Promise<void>;
  // Recording keep-alive. Optional: builds made before it was added don't have these.
  startRecordingKeepAlive?(title: string, body: string, startedAtMs: number): Promise<boolean>;
  updateRecordingKeepAlive?(title: string, body: string): Promise<void>;
  stopRecordingKeepAlive?(): Promise<void>;
  isRecordingKeepAliveActive?(): boolean;
  getKeepAlivePermission?(): Promise<KeepAlivePermission>;
  requestKeepAlivePermission?(): Promise<KeepAlivePermission>;
}

// Null in Expo Go, on web, and in any build without this module.
export default requireOptionalNativeModule<NativeMotionActivityModule>('MotionActivity');
