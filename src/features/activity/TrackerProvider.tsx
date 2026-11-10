/**
 * Foreground activity tracking (live sensors or recorded replay).
 *
 * Sensor callbacks only write into refs; a 10 Hz UI tick publishes a snapshot to React,
 * so 50 Hz sensor events never trigger 50 Hz re-renders. Subscriptions exist only while
 * status === 'tracking' and are removed on pause, stop, app backgrounding and unmount.
 */
import { Accelerometer, Gyroscope, Pedometer } from 'expo-sensors';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { refreshRecommendations } from '@/features/wellness/wellnessService';
import { dateKey } from '@/lib/dates';
import { useData } from '@/services/database/DataProvider';
import { insertSession } from '@/services/database/repositories';
import { harModelFor } from '@/services/ml/harModel';
import { SensorWindower } from '@/services/sensors/windower';
import { emptyDurations, type ActivityClass, type ActivityDurations, type SessionSource } from '@/types/domain';

import { orientationCheck, type OrientationCheck } from './orientation';
import { getReplayProgram } from './replayData';
import { ActivityEngine, type WindowResult } from './trackingEngine';

export type TrackerStatus = 'idle' | 'tracking' | 'paused';

export interface SensorAvailability {
  checked: boolean;
  accelerometer: boolean;
  gyroscope: boolean;
  pedometer: boolean;
}

export interface PredictionLogEntry {
  at: number; // seconds since session start (data time)
  label: ActivityClass;
  probability: number;
  trueLabel: ActivityClass | null;
}

export interface SavedSessionSummary {
  id: number | null;
  source: SessionSource;
  trackedSeconds: number;
  durations: ActivityDurations;
  windowCount: number;
  steps: number | null;
  tooShort: boolean;
  replayCorrectWindows?: number;
  /** Set when classification worked but writing the session to the database failed. */
  error?: string;
}

export interface TrackerSnapshot {
  status: TrackerStatus;
  mode: SessionSource;
  replayId: string | null;
  replayTitle: string | null;
  replayProgress: number;
  replayTrueLabel: ActivityClass | null;
  elapsedSeconds: number;
  current: WindowResult | null;
  streakSeconds: number;
  durations: ActivityDurations;
  windowCount: number;
  trackedSeconds: number;
  acc: { x: number; y: number; z: number } | null;
  gyro: { x: number; y: number; z: number } | null;
  accHistory: number[][];
  gyroHistory: number[][];
  accRateHz: number;
  gyroRateHz: number;
  steps: number | null;
  bufferedSamples: number;
  useGyro: boolean;
  modelId: string;
  log: PredictionLogEntry[];
  /** Gravity-direction placement check over the last ~3 s (live mode only). */
  orientation: OrientationCheck | null;
  warning: string | null;
  lastSaved: SavedSessionSummary | null;
}

interface TrackerContextValue {
  snap: TrackerSnapshot;
  availability: SensorAvailability;
  activeSubscriptions: number;
  startLive: () => Promise<{ ok: boolean; message?: string }>;
  startReplay: (programId: string, speed?: number) => { ok: boolean; message?: string };
  pause: () => void;
  resume: () => void;
  stop: () => Promise<SavedSessionSummary | null>;
  discard: () => void;
  recheckSensors: () => Promise<void>;
  clearLastSaved: () => void;
}

const HISTORY = 150; // 3 s at 50 Hz
const UI_TICK_MS = 100;
const REPLAY_TICK_MS = 100;

interface Runtime {
  status: TrackerStatus;
  mode: SessionSource;
  replayId: string | null;
  replaySpeed: number;
  replayIndex: number;
  replayWallStart: number;
  replayIndexAtStart: number;
  windower: SensorWindower | null;
  engine: ActivityEngine | null;
  startedAt: number;
  activeMs: number;
  resumedAt: number;
  subs: { remove: () => void }[];
  replayTimer: ReturnType<typeof setInterval> | null;
  acc: { x: number; y: number; z: number } | null;
  gyro: { x: number; y: number; z: number } | null;
  accHist: number[][];
  gyroHist: number[][];
  accCount: number;
  gyroCount: number;
  accTotal: number;
  rateWindowStart: number;
  accRate: number;
  gyroRate: number;
  stepsBase: number;
  stepsLive: number;
  stepsAvailable: boolean;
  log: PredictionLogEntry[];
  dataTime: number;
  replayCorrect: number;
  warning: string | null;
  sessionTrueLabelAt: ActivityClass | null;
}

function emptyHist(): number[][] {
  return [[], [], []];
}

function freshRuntime(): Runtime {
  return {
    status: 'idle',
    mode: 'live',
    replayId: null,
    replaySpeed: 1,
    replayIndex: 0,
    replayWallStart: 0,
    replayIndexAtStart: 0,
    windower: null,
    engine: null,
    startedAt: 0,
    activeMs: 0,
    resumedAt: 0,
    subs: [],
    replayTimer: null,
    acc: null,
    gyro: null,
    accHist: emptyHist(),
    gyroHist: emptyHist(),
    accCount: 0,
    gyroCount: 0,
    accTotal: 0,
    rateWindowStart: 0,
    accRate: 0,
    gyroRate: 0,
    stepsBase: 0,
    stepsLive: 0,
    stepsAvailable: false,
    log: [],
    dataTime: 0,
    replayCorrect: 0,
    warning: null,
    sessionTrueLabelAt: null,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function pushHist(h: number[][], x: number, y: number, z: number) {
  h[0].push(x);
  h[1].push(y);
  h[2].push(z);
  if (h[0].length > HISTORY) {
    h[0].shift();
    h[1].shift();
    h[2].shift();
  }
}

/** Snapshot fields derived purely from the runtime (no React state). */
type CoreSnapshot = Omit<TrackerSnapshot, 'lastSaved' | 'useGyro' | 'modelId'> & { engineUseGyro: boolean | null };

function snapshotOf(r: Runtime): CoreSnapshot {
  const now = Date.now();
  const engine = r.engine;
  const program = r.replayId ? getReplayProgram(r.replayId) : undefined;
  const elapsed =
    r.mode === 'replay' ? r.dataTime : (r.activeMs + (r.status === 'tracking' ? now - r.resumedAt : 0)) / 1000;
  return {
    status: r.status,
    mode: r.mode,
    replayId: r.replayId,
    replayTitle: program?.title ?? null,
    replayProgress: program ? Math.min(1, r.replayIndex / program.samples[0].length) : 0,
    replayTrueLabel: r.sessionTrueLabelAt,
    elapsedSeconds: elapsed,
    current: engine?.current ?? null,
    streakSeconds: engine?.currentStreakSeconds ?? 0,
    durations: engine ? { ...engine.durations } : emptyDurations(),
    windowCount: engine?.windowCount ?? 0,
    trackedSeconds: engine?.trackedSeconds ?? 0,
    acc: r.acc,
    gyro: r.gyro,
    accHistory: r.accHist.map((a) => a.slice()),
    gyroHistory: r.gyroHist.map((a) => a.slice()),
    accRateHz: r.accRate,
    gyroRateHz: r.gyroRate,
    steps: r.stepsAvailable ? r.stepsBase + r.stepsLive : null,
    bufferedSamples: r.windower?.buffered ?? 0,
    engineUseGyro: engine?.useGyro ?? null,
    log: r.log.slice(),
    orientation:
      r.mode === 'live' && r.accHist[0].length >= 50
        ? orientationCheck({ x: mean(r.accHist[0]), y: mean(r.accHist[1]), z: mean(r.accHist[2]) })
        : null,
    warning: r.warning,
  };
}

async function checkSensors(): Promise<SensorAvailability> {
  const safe = (p: Promise<boolean>) => p.catch(() => false);
  const [accelerometer, gyroscope, pedometer] = await Promise.all([
    safe(Accelerometer.isAvailableAsync()),
    safe(Gyroscope.isAvailableAsync()),
    safe(Pedometer.isAvailableAsync()),
  ]);
  return { checked: true, accelerometer, gyroscope, pedometer };
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

export function TrackerProvider({ children }: { children: ReactNode }) {
  const { db, prefs, invalidate } = useData();
  const rt = useRef<Runtime>(freshRuntime());
  const [lastSaved, setLastSaved] = useState<SavedSessionSummary | null>(null);
  const [availability, setAvailability] = useState<SensorAvailability>({
    checked: false,
    accelerometer: false,
    gyroscope: false,
    pedometer: false,
  });
  const [activeSubscriptions, setActiveSubscriptions] = useState(0);

  const [core, setCore] = useState<CoreSnapshot>(() => snapshotOf(freshRuntime()));
  const publish = useCallback(() => setCore(snapshotOf(rt.current)), []);

  // 10 Hz UI tick while a session exists
  const [ticking, setTicking] = useState(false);
  useEffect(() => {
    if (!ticking) return;
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
        if (r.mode === 'live' && r.status === 'tracking' && now - r.resumedAt > 2500) {
          r.warning =
            r.accRate < 1
              ? 'No accelerometer data is arriving. The sensor may be unavailable or blocked.'
              : r.accRate < 30
                ? `Accelerometer is delivering only ~${Math.round(r.accRate)} Hz (50 Hz requested). Predictions use resampled data and may be less reliable.`
                : null;
        }
      }
      publish();
    }, UI_TICK_MS);
    return () => clearInterval(id);
  }, [ticking, publish]);

  useEffect(() => {
    let cancelled = false;
    void checkSensors().then((a) => {
      if (!cancelled) setAvailability(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const recheckSensors = useCallback(() => checkSensors().then(setAvailability), []);

  const removeSubs = useCallback(() => {
    const r = rt.current;
    for (const s of r.subs) {
      try {
        s.remove();
      } catch {
        // already removed
      }
    }
    r.subs = [];
    if (r.replayTimer) {
      clearInterval(r.replayTimer);
      r.replayTimer = null;
    }
    setActiveSubscriptions(0);
  }, []);

  const handleWindows = useCallback((windows: Float64Array[][], trueLabel: ActivityClass | null) => {
    const r = rt.current;
    if (!r.engine) return;
    if (r.mode === 'live') r.dataTime = (r.activeMs + Date.now() - r.resumedAt) / 1000;
    for (const w of windows) {
      try {
        const res = r.engine.processWindow(w);
        const p = res.raw.probabilities[res.raw.probabilities.indexOf(Math.max(...res.raw.probabilities))];
        if (trueLabel && res.label === trueLabel) r.replayCorrect++;
        r.log.unshift({ at: r.dataTime, label: res.label, probability: p, trueLabel });
        if (r.log.length > 12) r.log.pop();
      } catch (e) {
        r.warning = `Classification failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }, []);

  const subscribeLive = useCallback(async () => {
    const r = rt.current;
    const sign = Platform.OS === 'ios' ? -1 : 1; // iOS reports acceleration with the opposite sign to Android/UCI
    const fallbackT = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    Accelerometer.setUpdateInterval(20);
    r.subs.push(
      Accelerometer.addListener((e) => {
        const t = e.timestamp > 0 ? e.timestamp : fallbackT();
        const x = e.x * sign;
        const y = e.y * sign;
        const z = e.z * sign;
        r.acc = { x, y, z };
        r.accCount++;
        r.accTotal++;
        pushHist(r.accHist, x, y, z);
        const win = r.windower?.pushAccelerometer({ t, x, y, z }) ?? [];
        if (win.length) handleWindows(win, null);
      }),
    );
    if (r.engine?.useGyro) {
      Gyroscope.setUpdateInterval(20);
      r.subs.push(
        Gyroscope.addListener((e) => {
          const t = e.timestamp > 0 ? e.timestamp : fallbackT();
          r.gyro = { x: e.x, y: e.y, z: e.z };
          r.gyroCount++;
          pushHist(r.gyroHist, e.x, e.y, e.z);
          const win = r.windower?.pushGyroscope({ t, x: e.x, y: e.y, z: e.z }) ?? [];
          if (win.length) handleWindows(win, null);
        }),
      );
    }
    if (r.stepsAvailable) {
      r.stepsBase += r.stepsLive;
      r.stepsLive = 0;
      try {
        r.subs.push(
          Pedometer.watchStepCount((res) => {
            r.stepsLive = res.steps;
          }),
        );
      } catch {
        r.stepsAvailable = false;
      }
    }
    setActiveSubscriptions(r.subs.length);
  }, [handleWindows]);

  const startReplayTimer = useCallback(() => {
    const r = rt.current;
    const program = r.replayId ? getReplayProgram(r.replayId) : undefined;
    if (!program) return;
    // Pace playback from wall-clock time so JS timer drift doesn't slow the replay below 50 Hz.
    r.replayWallStart = Date.now();
    r.replayIndexAtStart = r.replayIndex;
    const maxPerTick = Math.ceil(program.sampleRateHz * r.replaySpeed); // at most ~1 s of data per tick after a stall
    r.replayTimer = setInterval(() => {
      const n = program.samples[0].length;
      const due =
        r.replayIndexAtStart + Math.floor(((Date.now() - r.replayWallStart) / 1000) * program.sampleRateHz * r.replaySpeed);
      for (let k = 0; k < maxPerTick && r.replayIndex < Math.min(due, n); k++) {
        const i = r.replayIndex;
        const t = i / program.sampleRateHz;
        const s = program.samples;
        r.acc = { x: s[0][i], y: s[1][i], z: s[2][i] };
        r.gyro = { x: s[3][i], y: s[4][i], z: s[5][i] };
        r.accCount++;
        r.gyroCount++;
        pushHist(r.accHist, s[0][i], s[1][i], s[2][i]);
        pushHist(r.gyroHist, s[3][i], s[4][i], s[5][i]);
        r.sessionTrueLabelAt = program.labels[i];
        const w1 = r.windower?.pushAccelerometer({ t, x: s[0][i], y: s[1][i], z: s[2][i] }) ?? [];
        const w2 = r.windower?.pushGyroscope({ t, x: s[3][i], y: s[4][i], z: s[5][i] }) ?? [];
        r.replayIndex++;
        r.dataTime = r.replayIndex / program.sampleRateHz;
        // label of the window = recorded label at the window's centre (last window ends at i)
        const centre = program.labels[Math.max(0, i - 64)];
        if (w1.length || w2.length) handleWindows([...w1, ...w2], centre);
      }
      if (r.replayIndex >= n && r.replayTimer) {
        clearInterval(r.replayTimer);
        r.replayTimer = null;
        r.status = 'paused';
        r.warning = 'Replay finished. Stop to save it as a demo session (excluded from your personal stats).';
      }
    }, REPLAY_TICK_MS);
    setActiveSubscriptions(1);
  }, [handleWindows]);

  const startLive = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    const r = rt.current;
    if (r.status !== 'idle') return { ok: false, message: 'A session is already running.' };
    let avail = availability;
    if (!avail.checked) {
      avail = await checkSensors();
      setAvailability(avail);
    }
    if (!avail.accelerometer) {
      return { ok: false, message: 'No accelerometer is available on this device, so live tracking cannot run. Try Recorded Replay instead.' };
    }
    let stepsAvailable = false;
    if (avail.pedometer) {
      try {
        const perm = await Pedometer.requestPermissionsAsync();
        stepsAvailable = perm.granted;
      } catch {
        stepsAvailable = false;
      }
    }
    const fresh = freshRuntime();
    fresh.mode = 'live';
    fresh.status = 'tracking';
    fresh.windower = new SensorWindower({ useGyro: avail.gyroscope });
    fresh.engine = new ActivityEngine({ useGyro: avail.gyroscope, smoothing: prefs.smoothingEnabled });
    fresh.startedAt = Date.now();
    fresh.resumedAt = Date.now();
    fresh.rateWindowStart = Date.now();
    fresh.stepsAvailable = stepsAvailable;
    fresh.warning = avail.gyroscope
      ? null
      : 'No gyroscope detected: using the accelerometer-only model (lower held-out accuracy).';
    rt.current = fresh;
    setLastSaved(null);
    await subscribeLive();
    setTicking(true);
    return { ok: true };
  }, [availability, prefs.smoothingEnabled, subscribeLive]);

  const startReplay = useCallback(
    (programId: string, speed = 1): { ok: boolean; message?: string } => {
      const r = rt.current;
      if (r.status !== 'idle') return { ok: false, message: 'Stop the current session first.' };
      const program = getReplayProgram(programId);
      if (!program) return { ok: false, message: 'Unknown replay sequence.' };
      const fresh = freshRuntime();
      fresh.mode = 'replay';
      fresh.status = 'tracking';
      fresh.replayId = programId;
      fresh.replaySpeed = speed;
      fresh.windower = new SensorWindower({ useGyro: true });
      fresh.engine = new ActivityEngine({ useGyro: true, smoothing: prefs.smoothingEnabled });
      fresh.startedAt = Date.now();
      fresh.resumedAt = Date.now();
      fresh.rateWindowStart = Date.now();
      rt.current = fresh;
      setLastSaved(null);
      startReplayTimer();
      setTicking(true);
      return { ok: true };
    },
    [prefs.smoothingEnabled, startReplayTimer],
  );

  const pause = useCallback(() => {
    const r = rt.current;
    if (r.status !== 'tracking') return;
    removeSubs();
    r.status = 'paused';
    r.activeMs += Date.now() - r.resumedAt;
    if (r.mode === 'live') {
      // a live pause breaks signal continuity; replay pauses do not
      r.windower?.reset();
      r.engine?.markSegmentBreak();
    }
    publish();
  }, [publish, removeSubs]);

  const resume = useCallback(() => {
    const r = rt.current;
    if (r.status !== 'paused') return;
    const program = r.replayId ? getReplayProgram(r.replayId) : undefined;
    if (r.mode === 'replay' && program && r.replayIndex >= program.samples[0].length) return;
    r.status = 'tracking';
    r.resumedAt = Date.now();
    r.rateWindowStart = Date.now();
    r.warning = null;
    if (r.mode === 'live') void subscribeLive();
    else startReplayTimer();
    publish();
  }, [publish, startReplayTimer, subscribeLive]);

  const discard = useCallback(() => {
    removeSubs();
    rt.current = freshRuntime();
    setTicking(false);
    publish();
  }, [publish, removeSubs]);

  const stop = useCallback(async (): Promise<SavedSessionSummary | null> => {
    const r = rt.current;
    if (r.status === 'idle') return null;
    removeSubs();
    if (r.status === 'tracking') r.activeMs += Date.now() - r.resumedAt;
    const engine = r.engine;
    const endedAt = Date.now();
    const summary: SavedSessionSummary = {
      id: null,
      source: r.mode,
      trackedSeconds: engine?.trackedSeconds ?? 0,
      durations: engine ? { ...engine.durations } : emptyDurations(),
      windowCount: engine?.windowCount ?? 0,
      steps: r.mode === 'live' && r.stepsAvailable ? r.stepsBase + r.stepsLive : null,
      tooShort: !engine || engine.windowCount === 0,
      replayCorrectWindows: r.mode === 'replay' ? r.replayCorrect : undefined,
    };
    const activeSeconds = r.activeMs / 1000;
    rt.current = freshRuntime();
    setTicking(false);
    // The UI tick has stopped, so push the idle state now — otherwise the screen stays on "tracking".
    publish();
    if (!summary.tooShort && engine) {
      try {
        summary.id = await insertSession(db, {
          source: summary.source,
          startedAt: r.startedAt,
          endedAt,
          dateKey: dateKey(r.startedAt),
          trackedSeconds: summary.trackedSeconds,
          durations: summary.durations,
          windowCount: summary.windowCount,
          steps: summary.steps,
          modelId: harModelFor(engine.useGyro).modelId,
          replaySequence: r.replayId,
          meanSampleRateHz: summary.source === 'live' && activeSeconds > 0 ? r.accTotal / activeSeconds : null,
        });
        if (summary.source === 'live') await refreshRecommendations(db, prefs);
        invalidate();
      } catch (e) {
        summary.error = `Could not save session: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    setLastSaved(summary);
    return summary;
  }, [db, invalidate, prefs, publish, removeSubs]);

  // Foreground-only tracking: pause when the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && rt.current.status === 'tracking' && rt.current.mode === 'live') {
        pause();
        rt.current.warning = 'Live tracking paused because the app left the screen. Your all-day activity keeps being noted by your phone.';
      }
    });
    return () => sub.remove();
  }, [pause]);

  // Remove every subscription if the provider ever unmounts.
  useEffect(() => () => removeSubs(), [removeSubs]);

  const clearLastSaved = useCallback(() => setLastSaved(null), []);

  const useGyro = core.engineUseGyro ?? availability.gyroscope;
  const snap: TrackerSnapshot = { ...core, useGyro, modelId: harModelFor(useGyro).modelId, lastSaved };

  return (
    <TrackerContext.Provider
      value={{
        snap,
        availability,
        activeSubscriptions,
        startLive,
        startReplay,
        pause,
        resume,
        stop,
        discard,
        recheckSensors,
        clearLastSaved,
      }}>
      {children}
    </TrackerContext.Provider>
  );
}

export function useTracker(): TrackerContextValue {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker must be used inside <TrackerProvider>');
  return ctx;
}
