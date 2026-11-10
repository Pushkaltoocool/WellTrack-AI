export type MotionType = 'stationary' | 'walking' | 'running' | 'automotive' | 'cycling' | 'unknown';

export type MotionConfidence = 'low' | 'medium' | 'high';

export interface MotionActivitySample {
  startMs: number;
  endMs: number;
  type: MotionType;
  confidence: MotionConfidence;
}

export type MotionPermission = 'granted' | 'denied' | 'undetermined' | 'restricted' | 'unavailable';

/** Recording keep-alive authorization. iOS: location (when in use or always = granted). Android: always granted. */
export type KeepAlivePermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface RecordingKeepAliveOptions {
  /** Android notification title. */
  title: string;
  /** Android notification text. */
  body: string;
  /** Epoch ms the Android notification chronometer counts up from. */
  startedAtMs: number;
}

export interface SensorSeries {
  t: number[];
  x: number[];
  y: number[];
  z: number[];
}

export interface CapturedChunk {
  id: string;
  startedAtMs: number;
  /** Acceleration in g, gravity included (matches expo-sensors Accelerometer on Android). `t` in seconds since boot. */
  acc: SensorSeries;
  /** Rotation rate in rad/s, or null when the device has no gyroscope. */
  gyro: SensorSeries | null;
}

export interface SensorCaptureOptions {
  windowSeconds?: number;
  periodSeconds?: number;
}

/**
 * A point where an activity begins. Native code returns these; `buildSegments` turns them into
 * samples. `gap` ends the previous segment without starting a new one (updates stopped, reboot).
 */
export interface RawMotionPoint {
  t: number;
  type: MotionType | 'gap';
  confidence: MotionConfidence;
}
