import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chips, EmptyState, KeyValue, Notice, ProgressBar, SectionHeader } from '@/components/ui/misc';
import { Companion } from '@/components/ui/Companions';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { ACTIVITY_LIST, activityColor, activityLabel, ACTIVITY_ICONS } from '@/features/activity/activityMeta';
import { MANUAL_STOP_TRIM_S, PLACEMENTS, type Placement, type RecordingMeta } from '@/features/activity/harRecordingFormat';
import { deleteRecording, listRecordings, saveRecordingsToFolder, shareRecordings } from '@/features/activity/harRecordingStore';
import { useTracker } from '@/features/activity/TrackerProvider';
import { backgroundRecordingSupported, requestBackgroundRecording } from '@/features/activity/recordingSession';
import { useHarRecorder } from '@/features/activity/useHarRecorder';
import { syncPendingRecordings, withdrawRecording } from '@/features/research/researchUpload';
import { useAccount } from '@/services/cloud/AccountProvider';
import { cloudErrorMessage } from '@/services/cloud/backup';
import { useData } from '@/services/database/DataProvider';
import { formatClock, formatDuration } from '@/lib/dates';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import { HAR_CLASSES, type ActivityClass } from '@/types/domain';

type Length = '60' | '120' | '300' | '600' | '1200' | '1800' | 'open';

/** What to actually do for each label, so recordings from different people mean the same thing. */
const GUIDE: Record<ActivityClass, string> = {
  WALKING: 'Walk at your normal pace on flat ground. Turning around is fine; stopping isn’t.',
  RUNNING: 'Jog or run at a steady pace outdoors or on a treadmill.',
  WALKING_UPSTAIRS: 'Only climb stairs. Pause the recording (or start a new one) on landings longer than a few steps.',
  WALKING_DOWNSTAIRS: 'Only go down stairs. Hold the rail if you like, just keep moving.',
  SITTING: 'Sit as you would in class or at your desk. Typing and small movements are fine.',
  STANDING: 'Stand in one place — queuing, waiting for the bus, chatting.',
  LAYING: 'Lie in bed the way you sleep, with the phone where it usually is at night (pocket, mattress or pillow).',
};
const LENGTHS: Record<'short' | 'long', { value: Length; label: string }[]> = {
  short: [{ value: '60', label: '1 min' }, { value: '120', label: '2 min' }, { value: '300', label: '5 min' }, { value: 'open', label: 'Until I stop' }],
  long: [{ value: '600', label: '10 min' }, { value: '1200', label: '20 min' }, { value: '1800', label: '30 min' }, { value: 'open', label: 'Until I stop' }],
};
type Countdown = '5' | '10' | '20';

const placementLabel = (p: Placement) => PLACEMENTS.find((x) => x.key === p)?.label ?? p;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function CollectScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { snap: tracker, availability } = useTracker();
  const { prefs } = useData();
  const { user } = useAccount();
  const contributing = !!prefs.researchRecordingsConsentAt && !!user;
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState<ActivityClass>('WALKING');
  const [placement, setPlacement] = useState<Placement>('pocket');
  const [length, setLength] = useState<Length>('120');
  const [countdown, setCountdown] = useState<Countdown>('10');
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);
  const [exporting, setExporting] = useState<'share' | 'folder' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lockSafe, setLockSafe] = useState(backgroundRecordingSupported());
  const [starting, setStarting] = useState(false);

  const reload = useCallback(() => {
    listRecordings()
      .then(setRecordings)
      .catch((e: unknown) => {
        setRecordings([]);
        setMessage(`Could not read saved recordings: ${e instanceof Error ? e.message : String(e)}`);
      });
  }, []);
  useEffect(reload, [reload]);

  const upload = useCallback((): Promise<void> => {
    if (!contributing || !user) return Promise.resolve();
    return Promise.resolve()
      .then(() => setUploading(true))
      .then(async () => {
        await syncPendingRecordings(user.uid);
      })
      .catch((e: unknown) => setMessage(`Upload paused: ${cloudErrorMessage(e)} Your recordings are safe on this phone and will upload later.`))
      .finally(() => {
        setUploading(false);
        reload();
      });
  }, [contributing, user, reload]);
  useEffect(() => {
    void upload();
  }, [upload]);
  const afterSave = useCallback(() => {
    reload();
    void upload();
  }, [reload, upload]);

  const { snap, start, stop, result, clearResult } = useHarRecorder(afterSave);
  const idle = snap.phase === 'idle';
  // A pocket brush shouldn't leave the screen mid-recording: block Android back while busy
  // (the iOS swipe-back is disabled through the screen options below).
  useEffect(() => {
    if (idle) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [idle]);
  const limitSeconds = length === 'open' ? null : Number(length);

  const totals = useMemo(() => {
    const t = Object.fromEntries(HAR_CLASSES.map((c) => [c, 0])) as Record<ActivityClass, number>;
    for (const r of recordings ?? []) t[r.label] += r.durationSeconds;
    return t;
  }, [recordings]);
  const maxTotal = Math.max(1, ...Object.values(totals));

  const blocked =
    tracker.status !== 'idle'
      ? 'Stop the activity tracking session first — both use the motion sensors.'
      : availability.checked && !availability.accelerometer
        ? 'This device isn’t sharing accelerometer data, so nothing can be recorded.'
        : null;

  const onStart = async () => {
    setMessage(null);
    let background: { label: string; placement: string } | null = null;
    if (lockSafe && backgroundRecordingSupported()) {
      setStarting(true);
      const ok = await requestBackgroundRecording().catch(() => false);
      setStarting(false);
      if (ok) background = { label: activityLabel(label), placement: placementLabel(placement) };
      else setMessage(Platform.OS === 'ios'
        ? 'Without location access the recording stops if the phone locks. You can allow it in Settings → Wren → Location → While Using.'
        : 'Without activity access the recording stops if the screen turns off. You can allow it in Settings → Apps → Wren → Permissions.');
    }
    start({ label, placement, useGyro: availability.gyroscope, countdownSeconds: Number(countdown), limitSeconds, background });
  };

  const onExport = async (how: 'share' | 'folder', ids = (recordings ?? []).map((r) => r.id)) => {
    if (ids.length === 0) return;
    setExporting(how);
    setMessage(null);
    try {
      if (how === 'share') {
        if (!(await shareRecordings(ids))) setMessage('Sharing isn’t available on this device.');
      } else {
        const name = await saveRecordingsToFolder(ids);
        if (name) setMessage(`Saved ${name} to the folder you picked.`);
      }
    } catch (e) {
      setMessage(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(null);
    }
  };

  const onRecordingPress = (r: RecordingMeta) =>
    Alert.alert(`${activityLabel(r.label)} · ${placementLabel(r.placement)}`, `${formatDuration(r.durationSeconds)} recorded ${formatClock(r.startedAt)}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Share this one', onPress: () => void onExport('share', [r.id]) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteRecording(r.id);
          reload();
          if (r.uploadedAt && user) void withdrawRecording(user.uid, r.id).catch((e: unknown) => setMessage(`Deleted here, but not yet from the research dataset: ${cloudErrorMessage(e)}`));
        },
      },
    ]);

  // ——— Countdown & recording ———
  if (!idle) {
    const recordingNow = snap.phase === 'recording';
    return (
      <Screen>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <View style={styles.stage}>
          <View style={styles.ground} />
          <Companion id="pika" size={168} pose={recordingNow ? 'cheer' : 'idle'} />
          <AppText variant="caption" muted style={{ marginTop: 14 }}>
            {snap.phase === 'countdown' ? 'Get into position. Recording starts in' : snap.phase === 'saving' ? 'Saving…' : 'Recording'}
          </AppText>
          <AppText variant="display" style={styles.bigNumber} accessibilityLiveRegion="polite">
            {snap.phase === 'countdown' ? String(snap.countdown) : clock(snap.elapsedSeconds)}
          </AppText>
          <View style={styles.labelChip}>
            <Ionicons name={ACTIVITY_ICONS[label]} size={18} color={activityColor(label)} />
            <AppText variant="bodyStrong">
              {activityLabel(label)} · {placementLabel(placement)}
            </AppText>
          </View>
        </View>

        {recordingNow && limitSeconds ? (
          <View style={{ gap: 6, marginBottom: spacing.lg }}>
            <ProgressBar value={Math.min(1, snap.elapsedSeconds / limitSeconds)} color={colors.teal} />
            <AppText variant="caption" muted align="center">
              Stops by itself at {clock(limitSeconds)} — the phone buzzes when it’s done.
            </AppText>
          </View>
        ) : null}

        {recordingNow ? (
          <View style={[styles.lockNote, snap.lockSafe && styles.lockNoteOk]}>
            <Ionicons name={snap.lockSafe ? 'lock-closed' : 'phone-portrait-outline'} size={18} color={snap.lockSafe ? colors.teal : colors.textSecondary} />
            <AppText variant="caption" secondary style={{ flex: 1 }}>
              {snap.lockSafe
                ? Platform.OS === 'ios'
                  ? 'You can lock your phone. The timer keeps going in your Dynamic Island and on the Lock Screen.'
                  : 'You can lock your phone. The timer keeps going in your notifications.'
                : 'Keep the screen on until you stop. Locking the phone ends the recording.'}
            </AppText>
          </View>
        ) : null}

        {snap.phase === 'countdown' ? (
          <Button label="Cancel" variant="secondary" icon="close" onPress={() => void stop()} />
        ) : (
          <Pressable
            onLongPress={() => void stop('manual')}
            delayLongPress={700}
            disabled={snap.phase === 'saving'}
            accessibilityRole="button"
            accessibilityLabel="Stop and save recording"
            accessibilityHint="Press and hold to stop"
            style={({ pressed }) => [styles.holdButton, pressed && styles.holdButtonPressed]}>
            <Ionicons name="stop" size={18} color={colors.onInk} />
            <AppText variant="bodyStrong" color={colors.onInk}>
              Hold to stop & save
            </AppText>
          </Pressable>
        )}
        <AppText variant="caption" muted align="center" style={{ marginTop: spacing.md }}>
          {`Holding avoids stops from pocket taps. The last ${MANUAL_STOP_TRIM_S} s are dropped when you stop by hand, so taking the phone out isn’t labelled as ${activityLabel(label).toLowerCase()}.`}
        </AppText>

        {recordingNow ? (
          <Card style={{ marginTop: spacing.xl }}>
            <KeyValue k="Samples (50 Hz grid)" v={snap.sampleCount.toLocaleString()} mono />
            <KeyValue k="Accelerometer" v={`${snap.accRateHz.toFixed(0)} Hz`} mono />
            <KeyValue k="Gyroscope" v={availability.gyroscope ? `${snap.gyroRateHz.toFixed(0)} Hz` : 'not available'} mono />
            <KeyValue k="Continuous segments" v={String(snap.segments)} mono />
            <View style={{ marginTop: spacing.sm }}>
              <SourceTag source="measured" label="Live sensor input" />
            </View>
          </Card>
        ) : null}
      </Screen>
    );
  }

  // ——— Setup & recordings ———
  return (
    <Screen back title="Record an activity">
      <Stack.Screen options={{ gestureEnabled: true }} />
      <View style={styles.intro}>
        <Companion id="pika" size={92} pose="cheer" />
        <View style={styles.introBubble}>
          <AppText style={styles.introQuote}>Do one thing for a couple of minutes and I’ll learn what it feels like.</AppText>
          <AppText variant="caption" muted>Every recording teaches the next version of Wren’s activity model.</AppText>
        </View>
      </View>
      {contributing ? (
        <View style={styles.statusRow}>
          <Ionicons name="cloud-done-outline" size={18} color={colors.teal} />
          <AppText variant="caption" secondary style={{ flex: 1 }}>{uploading ? 'Uploading new recordings…' : 'You’re contributing. New recordings upload by themselves.'}</AppText>
        </View>
      ) : (
        <Pressable onPress={() => router.push('/research')} accessibilityRole="button" style={({ pressed }) => [styles.statusRow, styles.statusAsk, pressed && { opacity: 0.8 }]}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.text} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Share recordings to train the model</AppText>
            <AppText variant="caption" muted>They stay on this phone until you agree. Motion only.</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Pressable>
      )}
      <SectionHeader title="What will you be doing?" />
      <View style={styles.grid}>
        {ACTIVITY_LIST.map((a) => {
          const on = a.key === label;
          return (
            <Pressable
              key={a.key}
              onPress={() => {
                setLabel(a.key);
                setLength(a.key === 'LAYING' ? '1200' : '120');
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.tile, on && { borderColor: a.color, backgroundColor: `${a.color}1A` }]}>
              <Ionicons name={a.icon} size={22} color={on ? a.color : colors.textSecondary} />
              <AppText variant="bodyStrong" style={{ fontSize: 15 }}>
                {a.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <AppText variant="caption" secondary style={{ marginTop: spacing.md }}>{GUIDE[label]}</AppText>

      <SectionHeader title="Where is the phone?" />
      <View style={{ gap: spacing.sm }}>
        {PLACEMENTS.map((p) => {
          const on = p.key === placement;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPlacement(p.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.row, on && styles.rowOn]}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{p.label}</AppText>
                <AppText variant="caption" muted>
                  {p.hint}
                </AppText>
              </View>
              <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.teal : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <SectionHeader title="How long?" />
      <Chips<Length>
        options={LENGTHS[label === 'LAYING' ? 'long' : 'short']}
        value={length}
        onChange={setLength}
      />
      <SectionHeader title="Countdown before recording" />
      <Chips<Countdown>
        options={[
          { value: '5', label: '5 s' },
          { value: '10', label: '10 s' },
          { value: '20', label: '20 s' },
        ]}
        value={countdown}
        onChange={setCountdown}
      />

      {backgroundRecordingSupported() ? (
        <View style={[styles.statusRow, { marginTop: spacing.xl }]}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Keep recording when I lock my phone</AppText>
            <AppText variant="caption" muted>
              {Platform.OS === 'ios'
                ? 'Shows a timer in your Dynamic Island. iOS needs location access to keep Wren awake; your location is never stored or sent.'
                : 'Shows a timer in your notifications while it records.'}
            </AppText>
          </View>
          <Switch value={lockSafe} onValueChange={setLockSafe} trackColor={{ true: colors.teal, false: colors.borderStrong }} accessibilityLabel="Keep recording when the phone is locked" />
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
        {blocked ? <Notice tone="warn">{blocked}</Notice> : null}
        <Button label="Start recording" icon="radio-button-on" onPress={() => void onStart()} loading={starting} disabled={!!blocked} testID="start-recording" />
        <AppText variant="caption" muted align="center">
          {`The phone buzzes when recording starts and when it ends. Do only ${activityLabel(label).toLowerCase()} the whole time; a few minutes per activity and placement is plenty.`}
        </AppText>
      </View>

      {result ? (
        <Card style={{ marginTop: spacing.md }}>
          <View style={styles.rowBetween}>
            <AppText variant="bodyStrong">{result.saved ? 'Recording saved' : 'Recording not saved'}</AppText>
            <Pressable onPress={clearResult} hitSlop={10} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <AppText variant="caption" secondary>
            {result.saved
              ? `${formatDuration(result.meta.durationSeconds)} of ${activityLabel(result.meta.label).toLowerCase()}${
                  result.meta.stoppedBy === 'background' ? ' — stopped early because the app left the screen' : ''
                }${result.meta.segments > 1 ? ` · ${result.meta.segments} segments (sensor gaps)` : ''}.`
              : result.reason}
          </AppText>
        </Card>
      ) : null}
      {message ? (
        <View style={{ marginTop: spacing.md }}>
          <Notice tone={message.startsWith('Saved') ? 'info' : 'warn'}>{message}</Notice>
        </View>
      ) : null}

      <SectionHeader title="Your recordings" subtitle={recordings?.length ? 'Tap one to share or delete it' : undefined} />
      {recordings && recordings.length > 0 ? (
        <>
          <Card>
            {ACTIVITY_LIST.map((a) => (
              <View key={a.key} style={styles.totalRow}>
                <AppText variant="caption" style={{ width: 132 }}>
                  {a.label}
                </AppText>
                <View style={{ flex: 1 }}>
                  <ProgressBar value={totals[a.key] / maxTotal} color={a.color} height={6} />
                </View>
                <AppText variant="mono" color={colors.textMuted} style={{ width: 52, textAlign: 'right' }}>
                  {clock(totals[a.key])}
                </AppText>
              </View>
            ))}
          </Card>
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            {recordings.map((r) => (
              <Pressable key={r.id} onPress={() => onRecordingPress(r)} style={styles.row} accessibilityRole="button">
                <View style={[styles.recIcon, { backgroundColor: `${activityColor(r.label)}22` }]}>
                  <Ionicons name={ACTIVITY_ICONS[r.label]} size={20} color={activityColor(r.label)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">
                    {activityLabel(r.label)} · {placementLabel(r.placement)}
                  </AppText>
                  <AppText variant="caption" muted>
                    {new Date(r.startedAt).toLocaleDateString('en', { day: 'numeric', month: 'short' })} {formatClock(r.startedAt)} · {clock(r.durationSeconds)}
                    {r.useGyro ? '' : ' · no gyro'}
                    {contributing ? (r.uploadedAt ? ' · contributed' : ' · waiting to upload') : ''}
                  </AppText>
                </View>
                {contributing ? <Ionicons name={r.uploadedAt ? 'cloud-done-outline' : 'cloud-outline'} size={18} color={r.uploadedAt ? colors.teal : colors.textMuted} /> : null}
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button label={`Share all (${recordings.length}) as CSV`} icon="share-outline" onPress={() => void onExport('share')} loading={exporting === 'share'} disabled={!!exporting} />
            {Platform.OS === 'android' ? (
              <Button label="Save CSV to a folder" icon="folder-open-outline" variant="secondary" onPress={() => void onExport('folder')} loading={exporting === 'folder'} disabled={!!exporting} />
            ) : null}
            <AppText variant="caption" muted>
              {`One CSV with every recording: 50 Hz rows of acceleration (g) and rotation (rad/s), each tagged with its label and phone placement. ${
                Platform.OS === 'ios' ? 'In the share sheet, “Save to Files” puts it in iCloud Drive or On My iPhone; AirDrop sends it to a Mac.' : 'Send it to your computer or Drive, or save it into a folder such as Documents.'
              } Then run ml/har/collected.py on it.`}
            </AppText>
          </View>
        </>
      ) : (
        <Card>
          <EmptyState compact icon="pulse-outline" title={recordings ? 'No recordings yet' : 'Loading…'} body="Recordings you make here will appear with their label, placement and length." />
        </Card>
      )}
    </Screen>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stage: { alignItems: 'center', gap: 10, paddingTop: 12, paddingBottom: 28 },
    ground: { position: 'absolute', top: 152, width: 150, height: 24, borderRadius: 75, backgroundColor: 'rgba(185,128,63,0.14)' },
    lockNote: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radii.md, backgroundColor: c.surfaceAlt, marginBottom: spacing.lg },
    lockNoteOk: { backgroundColor: c.tealSoft },
    intro: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: spacing.lg },
    introBubble: { flex: 1, backgroundColor: c.surface, borderRadius: radii.lg, borderBottomLeftRadius: 6, padding: 16, gap: 6, marginBottom: 14 },
    introQuote: { fontFamily: 'FrauncesItalic', fontSize: 18, lineHeight: 24, color: c.text },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radii.lg, backgroundColor: c.surface },
    statusAsk: { borderWidth: StyleSheet.hairlineWidth, borderColor: c.borderStrong },
    bigNumber: { fontSize: 64, lineHeight: 72, fontVariant: ['tabular-nums'] },
    labelChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: c.surfaceAlt },
    holdButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 56, borderRadius: radii.pill, backgroundColor: c.ink },
    holdButtonPressed: { backgroundColor: c.inkSoft, transform: [{ scale: 0.98 }] },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: {
      width: '48%',
      flexGrow: 1,
      minHeight: 76,
      gap: 6,
      padding: spacing.md,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      minHeight: 56,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    rowOn: { borderColor: c.teal, backgroundColor: c.tealSoft },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
    totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
    recIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  });
