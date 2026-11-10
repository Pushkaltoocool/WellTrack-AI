/**
 * Records labelled sensor data for the personal HAR dataset.
 *
 * Uses the same SensorWindower as live tracking (with 1-sample "windows"), so recordings hold
 * exactly the 50 Hz resampled signal the classifier sees. Sensor callbacks only write into refs;
 * a 4 Hz tick publishes progress. The screen is kept awake while recording, and leaving the app
 * stops and saves the recording (JS sensors stop in the background).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { SensorWindower, type SixChannelWindow } from '@/services/sensors/windower';
import type { ActivityClass } from '@/types/domain';

import {
  emptyBuffer,
  MANUAL_STOP_TRIM_S,
  MAX_RECORDING_S,
  recordingId,
  segmentCount,
  trimEnd,
  type Placement,
  type RecordingMeta,
  type SampleBuffer,
} from './harRecordingFormat';
import { saveRecording } from './harRecordingStore';
import { ACTIVITY_SYMBOLS, beginBackgroundRecording, endBackgroundRecording } from './recordingSession';

export type RecorderPhase = 'idle' | 'countdown' | 'recording' | 'saving';

export interface RecorderSnapshot {
  phase: RecorderPhase;
  /** True once the recording will survive the phone being locked. */
  lockSafe: boolean;
  countdown: number;
  elapsedSeconds: number;
  sampleCount: number;
  segments: number;
  accRateHz: number;
  gyroRateHz: number;
}

export interface RecorderOptions {
  label: ActivityClass;
  placement: Placement;
  useGyro: boolean;
  countdownSeconds: number;
  /** Auto-stop after this many seconds; null records until stopped (capped at MAX_RECORDING_S). */
  limitSeconds: number | null;
  /** Keep recording with the phone locked (iOS location keep-alive / Android foreground service) and show a Live Activity. */
  background?: { label: string; placement: string } | null;
}

export type StopResult = { saved: true; meta: RecordingMeta } | { saved: false; reason: string };

const KEEP_AWAKE_TAG = 'har-recording';
const TICK_MS = 250;
const MIN_SAMPLES = 128; // one classifier window

interface Runtime {
  opts: RecorderOptions | null;
  windower: SensorWindower | null;
  buf: SampleBuffer;
  segment: number;
  seenResets: number;
  t0: number | null;
  subs: { remove: () => void }[];
  startedAt: number;
  accTotal: number;
  gyroTotal: number;
  accCount: number;
  gyroCount: number;
  rateWindowStart: number;
  accRate: number;
  gyroRate: number;
  /** The keep-alive is running, so backgrounding the app must not stop the recording. */
  keepAlive: boolean;
}

function freshRuntime(): Runtime {
  return {
    opts: null,
    windower: null,
    buf: emptyBuffer(),
    segment: 0,
    seenResets: 0,
    t0: null,
    subs: [],
    startedAt: 0,
    accTotal: 0,
    gyroTotal: 0,
    accCount: 0,
    gyroCount: 0,
    rateWindowStart: 0,
    accRate: 0,
    gyroRate: 0,
    keepAlive: false,
  };
}

const IDLE: RecorderSnapshot = { phase: 'idle', lockSafe: false, countdown: 0, elapsedSeconds: 0, sampleCount: 0, segments: 0, accRateHz: 0, gyroRateHz: 0 };

export function useHarRecorder(onSaved?: (meta: RecordingMeta) => void) {
  const rt = useRef<Runtime>(freshRuntime());
  const phaseRef = useRef<RecorderPhase>('idle');
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [snap, setSnap] = useState<RecorderSnapshot>(IDLE);
  /** Outcome of the last stop, however it was triggered (button, timer, app backgrounded). */
  const [result, setResult] = useState<StopResult | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const setPhase = useCallback((phase: RecorderPhase, countdown = 0) => {
    phaseRef.current = phase;
    const r = rt.current;
    setSnap({
      phase,
      lockSafe: r.keepAlive,
      countdown,
      elapsedSeconds: r.buf.t.length / 50,
      sampleCount: r.buf.t.length,
      segments: r.buf.t.length ? r.segment + 1 : 0,
      accRateHz: r.accRate,
      gyroRateHz: r.gyroRate,
    });
  }, []);

  /** Appends resampled 1-sample windows, tagging each with its grid time and segment. */
  const append = useCallback((samples: SixChannelWindow[]) => {
    const r = rt.current;
    const w = r.windower;
    if (!w || samples.length === 0) return;
    if (w.resetCount !== r.seenResets) {
      // a sensor gap reset the grid: these samples start a new contiguous segment
      r.seenResets = w.resetCount;
      if (r.buf.t.length) r.segment++;
    }
    const next = w.nextGridTime ?? 0;
    const dt = 1 / w.sampleRateHz;
    for (let k = 0; k < samples.length; k++) {
      const gridT = next - dt * (samples.length - k);
      if (r.t0 === null) r.t0 = gridT;
      r.buf.t.push(gridT - r.t0);
      r.buf.segment.push(r.segment);
      for (let c = 0; c < 6; c++) r.buf.ch[c].push(samples[k][c][0]);
    }
  }, []);

  const removeSubs = useCallback(() => {
    for (const s of rt.current.subs) {
      try {
        s.remove();
      } catch {
        // already removed
      }
    }
    rt.current.subs = [];
    if (countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
  }, []);

  const subscribe = useCallback(() => {
    const r = rt.current;
    const sign = Platform.OS === 'ios' ? -1 : 1; // match TrackerProvider: iOS acceleration is sign-flipped vs Android/UCI
    const fallbackT = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    Accelerometer.setUpdateInterval(20);
    r.subs.push(
      Accelerometer.addListener((e) => {
        r.accCount++;
        r.accTotal++;
        const t = e.timestamp > 0 ? e.timestamp : fallbackT();
        append(r.windower?.pushAccelerometer({ t, x: e.x * sign, y: e.y * sign, z: e.z * sign }) ?? []);
      }),
    );
    if (r.opts?.useGyro) {
      Gyroscope.setUpdateInterval(20);
      r.subs.push(
        Gyroscope.addListener((e) => {
          r.gyroCount++;
          r.gyroTotal++;
          const t = e.timestamp > 0 ? e.timestamp : fallbackT();
          append(r.windower?.pushGyroscope({ t, x: e.x, y: e.y, z: e.z }) ?? []);
        }),
      );
    }
  }, [append]);

  const stop = useCallback(
    async (stoppedBy: RecordingMeta['stoppedBy'] = 'manual'): Promise<StopResult | null> => {
      const phase = phaseRef.current;
      if (phase === 'saving' || phase === 'idle') return null;
      removeSubs();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      const r = rt.current;
      const opts = r.opts;
      if (phase === 'countdown' || !opts) {
        rt.current = freshRuntime();
        setPhase('idle');
        void endBackgroundRecording(null);
        return null; // cancelled before any data was recorded
      }
      void endBackgroundRecording(Date.now());
      setPhase('saving');
      const finish = (res: StopResult) => {
        setPhase('idle');
        setResult(res);
        if (res.saved) onSavedRef.current?.(res.meta);
        return res;
      };
      const activeSeconds = (Date.now() - r.startedAt) / 1000;
      const trim = stoppedBy === 'timer' ? 0 : MANUAL_STOP_TRIM_S;
      const buf = trimEnd(r.buf, trim);
      rt.current = freshRuntime();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (buf.t.length < MIN_SAMPLES) {
        return finish({ saved: false, reason: `Too short to keep: at least ${(MIN_SAMPLES / 50 + trim).toFixed(1)} s is needed${trim ? ` (the last ${trim} s are trimmed)` : ''}.` });
      }
      const meta: RecordingMeta = {
        id: recordingId(r.startedAt, opts.label, opts.placement),
        label: opts.label,
        placement: opts.placement,
        platform: Platform.OS,
        device: Device.modelName ?? 'unknown',
        osVersion: Device.osVersion ?? null,
        appVersion: Constants.expoConfig?.version ?? null,
        startedAt: r.startedAt,
        durationSeconds: buf.t.length / 50,
        sampleCount: buf.t.length,
        segments: segmentCount(buf),
        useGyro: opts.useGyro,
        meanAccRateHz: activeSeconds > 0 ? r.accTotal / activeSeconds : null,
        meanGyroRateHz: opts.useGyro && activeSeconds > 0 ? r.gyroTotal / activeSeconds : null,
        stoppedBy,
        trimmedEndSeconds: trim,
      };
      try {
        await saveRecording(meta, buf);
      } catch (e) {
        return finish({ saved: false, reason: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
      }
      return finish({ saved: true, meta });
    },
    [removeSubs, setPhase],
  );

  const begin = useCallback(() => {
    const r = rt.current;
    r.startedAt = Date.now();
    r.rateWindowStart = Date.now();
    subscribe();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    setPhase('recording');
    const bg = r.opts?.background;
    if (bg && r.opts) {
      const startedAtMs = r.startedAt;
      void beginBackgroundRecording({ label: bg.label, placement: bg.placement, symbol: ACTIVITY_SYMBOLS[r.opts.label] ?? 'figure.walk', startedAtMs }).then((ok) => {
        // Ignore a late answer for a recording that has already ended.
        if (rt.current.startedAt !== startedAtMs || phaseRef.current !== 'recording') return;
        rt.current.keepAlive = ok;
        // Safe to lock: let the screen sleep instead of holding it on for the whole recording.
        if (ok) void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
        setPhase('recording');
      });
    }
  }, [setPhase, subscribe]);

  const start = useCallback(
    (opts: RecorderOptions) => {
      if (phaseRef.current !== 'idle') return;
      const fresh = freshRuntime();
      fresh.opts = opts;
      fresh.windower = new SensorWindower({ useGyro: opts.useGyro, windowSize: 1, step: 1 });
      rt.current = fresh;
      setResult(null);
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      if (opts.countdownSeconds <= 0) {
        begin();
        return;
      }
      let left = opts.countdownSeconds;
      setPhase('countdown', left);
      countdownTimer.current = setInterval(() => {
        left--;
        if (left > 0) {
          setPhase('countdown', left);
          if (left <= 3) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
          return;
        }
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        begin();
      }, 1000);
    },
    [begin, setPhase],
  );

  // Progress tick + auto-stop while recording.
  const recording = snap.phase === 'recording';
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const r = rt.current;
      const now = Date.now();
      if (now - r.rateWindowStart >= 1000) {
        const secs = (now - r.rateWindowStart) / 1000;
        r.accRate = r.accCount / secs;
        r.gyroRate = r.gyroCount / secs;
        r.accCount = 0;
        r.gyroCount = 0;
        r.rateWindowStart = now;
      }
      const limit = Math.min(r.opts?.limitSeconds ?? MAX_RECORDING_S, MAX_RECORDING_S);
      if ((now - r.startedAt) / 1000 >= limit) {
        void stop('timer');
        return;
      }
      if (phaseRef.current === 'recording') setPhase('recording');
    }, TICK_MS);
    return () => clearInterval(id);
  }, [recording, setPhase, stop]);

  // Without the keep-alive, JS sensors stop when the app is backgrounded: save what was recorded so
  // far. With it, the recording carries on with the phone locked. iOS 'inactive' (Notification or
  // Control Centre pulled down) keeps sensors running either way.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !rt.current.keepAlive) void stop('background');
    });
    return () => sub.remove();
  }, [stop]);

  // Leaving the screen mid-recording keeps the data.
  useEffect(
    () => () => {
      if (phaseRef.current === 'recording') void stop('manual');
      else removeSubs();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    },
    [removeSubs, stop],
  );

  const clearResult = useCallback(() => setResult(null), []);
  return { snap, start, stop, result, clearResult };
}
