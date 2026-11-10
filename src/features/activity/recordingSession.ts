/**
 * Keeps a labelled recording alive with the phone locked, and shows it outside the app.
 *  - iOS: a location keep-alive (coordinates are discarded natively, never stored) + a Live Activity
 *    on the Lock Screen and in the Dynamic Island.
 *  - Android: a foreground service whose notification shows a running chronometer.
 * Live Activities only display; the keep-alive is what lets the sensors keep recording.
 */
import { Platform } from 'react-native';

import * as Motion from '../../../modules/motion-activity';

import type { RecordingActivityProps } from './RecordingActivity';

type LiveActivityHandle = {
  update: (props: RecordingActivityProps) => Promise<void> | void;
  end: (dismissalPolicy?: 'default' | 'immediate', props?: RecordingActivityProps) => Promise<void> | void;
};

let liveActivity: LiveActivityHandle | null = null;
let liveProps: RecordingActivityProps | null = null;

/** SF Symbols for the Live Activity. */
export const ACTIVITY_SYMBOLS: Record<string, string> = {
  WALKING: 'figure.walk',
  RUNNING: 'figure.run',
  WALKING_UPSTAIRS: 'figure.stairs',
  WALKING_DOWNSTAIRS: 'figure.stairs',
  SITTING: 'chair.lounge.fill',
  STANDING: 'figure.stand',
  LAYING: 'bed.double.fill',
};

export const backgroundRecordingSupported = () => Motion.isNativeAvailable();

export type KeepAlivePermission = Awaited<ReturnType<typeof Motion.getKeepAlivePermission>>;
export const keepAlivePermission = () => Motion.getKeepAlivePermission();

/** Asks for whatever the keep-alive needs (iOS: location "While Using"; Android: activity recognition). */
export async function requestBackgroundRecording(): Promise<boolean> {
  if (!backgroundRecordingSupported()) return false;
  if (Platform.OS === 'android') {
    const motion = await Motion.requestPermission();
    return motion === 'granted';
  }
  const status = await Motion.getKeepAlivePermission();
  if (status === 'granted') return true;
  return (await Motion.requestKeepAlivePermission()) === 'granted';
}

function startLiveActivity(props: RecordingActivityProps) {
  if (Platform.OS !== 'ios') return;
  try {
    // Lazy: the factory registers a native Live Activity at import, which only exists in iOS builds.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factory = (require('./RecordingActivity') as typeof import('./RecordingActivity')).default;
    liveActivity = factory.start(props, 'welltrack://collect') as unknown as LiveActivityHandle;
    liveProps = props;
  } catch (e) {
    console.warn('[live-activity] could not start', e);
    liveActivity = null;
  }
}

/**
 * Call when recording actually starts (after the countdown, app in the foreground).
 * Returns whether the recording will survive the phone being locked.
 */
export async function beginBackgroundRecording(props: Omit<RecordingActivityProps, 'endedAtMs'>): Promise<boolean> {
  startLiveActivity(props);
  if (!backgroundRecordingSupported()) return false;
  try {
    return await Motion.startRecordingKeepAlive({ title: `Recording · ${props.label}`, body: `${props.placement} · hold Stop in Wren when you’re done`, startedAtMs: props.startedAtMs });
  } catch (e) {
    console.warn('[keep-alive] could not start', e);
    return false;
  }
}

export async function endBackgroundRecording(endedAtMs: number | null): Promise<void> {
  const la = liveActivity;
  const props = liveProps;
  liveActivity = null;
  liveProps = null;
  if (la && props) {
    try {
      // Saved: leave the final time on the Lock Screen briefly. Cancelled: remove it right away.
      await la.end(endedAtMs ? 'default' : 'immediate', { ...props, endedAtMs });
    } catch (e) {
      console.warn('[live-activity] could not end', e);
    }
  }
  if (backgroundRecordingSupported()) await Motion.stopRecordingKeepAlive().catch(() => undefined);
}
