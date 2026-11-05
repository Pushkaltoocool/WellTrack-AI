import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { BreakdownBar, LiveSignalChart } from '@/components/charts/Charts';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState, KeyValue, Notice, Pill, ProgressBar, SectionHeader, Segmented, StatusDot } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { Owl } from '@/components/ui/Owl';
import { SourceTag } from '@/components/ui/SourceTag';
import { ACTIVITY_ICONS, ACTIVITY_LIST, activityColor, activityLabel } from '@/features/activity/activityMeta';
import { REPLAY_PROGRAMS } from '@/features/activity/replayData';
import { useTracker } from '@/features/activity/TrackerProvider';
import { formatClock, formatDuration, formatMinutes } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { deleteSession, listSessions } from '@/services/database/repositories';
import { HAR_MODEL, harModelFor } from '@/services/ml/harModel';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import { HAR_CLASSES, type ActivitySession } from '@/types/domain';

type Mode = 'live' | 'replay';

export default function ActivityScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, invalidate } = useData();
  const { snap, availability, startLive, startReplay, pause, resume, stop, discard, recheckSensors, activeSubscriptions, clearLastSaved } =
    useTracker();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(snap.status !== 'idle' ? snap.mode : 'live');
  // Deep links (e.g. Settings → "Open demo / replay mode") select the mode once per param change.
  const [seenParam, setSeenParam] = useState<string | undefined>(undefined);
  if (params.mode !== seenParam) {
    setSeenParam(params.mode);
    if (params.mode === 'replay' || params.mode === 'live') setMode(params.mode);
  }
  const [replayId, setReplayId] = useState(REPLAY_PROGRAMS[0]?.id ?? '');
  const [speed, setSpeed] = useState<'1' | '4'>('1');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);

  const sessions = useDbQuery((d) => listSessions(d, { limit: 20 }), []);

  const idle = snap.status === 'idle';
  const effectiveMode: Mode = idle ? mode : snap.mode;
  const current = snap.current;
  const topProb = current ? Math.max(...current.raw.probabilities) : 0;
  const model = harModelFor(snap.useGyro);

  const onStart = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = effectiveMode === 'live' ? await startLive() : startReplay(replayId, Number(speed));
      if (!res.ok) setMessage(res.message ?? 'Could not start.');
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      const res = await stop();
      if (res?.tooShort) setMessage('Session was too short to classify (needs at least 2.56 s of data), so it was not saved.');
      sessions.reload();
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (s: ActivitySession) =>
    Alert.alert('Delete session?', `${s.source === 'replay' ? 'Demo replay' : 'Live session'} from ${s.dateKey} ${formatClock(s.startedAt)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSession(db, s.id);
          invalidate();
        },
      },
    ]);

  return (
    <Screen back title="Today’s movement">
      <Segmented<Mode>
        options={[
          { value: 'live', label: 'Live sensors' },
          { value: 'replay', label: 'Recorded replay' },
        ]}
        value={effectiveMode}
        onChange={(v) => {
          if (!idle) {
            setMessage('Stop the current session before switching mode.');
            return;
          }
          setMode(v);
          setMessage(null);
        }}
      />

      <View style={styles.movementStage}>
        <View style={styles.owlRing}><Owl size={184} mood={current?.label.startsWith('WALKING') ? 4 : 3} pose={idle || snap.status === 'paused' ? 'sleep' : current?.label.startsWith('WALKING') ? 'walk' : 'idle'} /></View>
        <View style={{ alignItems: 'center', gap: 6 }} accessibilityLiveRegion="polite">
          <AppText variant="caption" muted>{effectiveMode === 'replay' ? 'Demo replay · excluded from your day' : snap.status === 'paused' ? 'Paused' : 'Right now'}</AppText>
          <AppText variant="display" align="center" testID="current-activity">{effectiveMode === 'live' && availability.checked && !availability.accelerometer ? 'Sensors unavailable' : current ? activityLabel(current.label) : idle ? 'Ready when you are' : 'Getting to know your movement…'}</AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Card style={{ flex: 1 }}><AppText variant="metric">{formatMinutes(snap.durations.WALKING + snap.durations.WALKING_UPSTAIRS + snap.durations.WALKING_DOWNSTAIRS)}</AppText><AppText variant="caption" secondary>active this session</AppText></Card>
        <Card style={{ flex: 1 }}><AppText variant="metric">{formatMinutes(snap.durations.SITTING + snap.durations.LAYING)}</AppText><AppText variant="caption" secondary>sedentary this session</AppText></Card>
      </View>
      <AppText variant="caption" secondary align="center" style={{ marginVertical: 18 }}>{effectiveMode === 'replay' ? 'A recorded sample, played back so you can see how recognition works. None of it is added to your day.' : availability.checked && !availability.accelerometer ? 'This phone or emulator isn’t sharing motion data. Your check-ins and suggestions still work as usual.' : 'Recognises walking, stairs, sitting, standing and lying down. Runs only while WellTrack is open. Place your phone sideways at your waist for best results.'}</AppText>
      <Card padded={false} style={{ backgroundColor: 'transparent' }}>
        {effectiveMode === 'live' && availability.checked && !availability.accelerometer ? <Button label="Try a demo replay" onPress={() => setMode('replay')} style={{ marginBottom: 10 }} /> : null}
        {/* Controls */}
        <View style={styles.controls}>
          {idle ? (
            <Button
              label={effectiveMode === 'live' ? 'Start tracking' : 'Start replay'}
              icon="play"
              onPress={onStart}
              loading={busy}
              style={{ flex: 1 }}
              disabled={effectiveMode === 'live' && availability.checked && !availability.accelerometer}
              testID="start-tracking"
            />
          ) : (
            <>
              {snap.status === 'tracking' ? (
                <Button label="Pause" icon="pause" variant="secondary" onPress={pause} style={{ flex: 1 }} />
              ) : (
                <Button
                  label="Resume"
                  icon="play"
                  variant="secondary"
                  onPress={resume}
                  style={{ flex: 1 }}
                  disabled={snap.mode === 'replay' && snap.replayProgress >= 1}
                />
              )}
              <Button label="Stop & save" icon="stop" variant="teal" onPress={onStop} loading={busy} style={{ flex: 1.3 }} testID="stop-tracking" />
            </>
          )}
        </View>
        {!idle ? (
          <Pressable
            onPress={() =>
              Alert.alert('Discard session?', 'Nothing from this session will be saved.', [
                { text: 'Keep tracking', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: discard },
              ])
            }
            style={{ alignSelf: 'center', marginTop: spacing.md }}
            accessibilityRole="button"
            hitSlop={10}>
            <AppText variant="caption" color={colors.textMuted}>
              Discard session
            </AppText>
          </Pressable>
        ) : null}
      </Card>

      {message ? (
        <View style={{ marginTop: spacing.md }}>
          <Notice tone="warn">{message}</Notice>
        </View>
      ) : null}
      {snap.orientation && !snap.orientation.matchesTraining && snap.status === 'tracking' ? (
        <View style={{ marginTop: spacing.md }}>
          <Notice tone="warn" icon="phone-landscape-outline" title="Placement differs from training data">
            {snap.orientation.message ?? ''}
          </Notice>
        </View>
      ) : null}
      {snap.warning ? (
        <View style={{ marginTop: spacing.md }}>
          <Notice tone="warn">{snap.warning}</Notice>
        </View>
      ) : null}

      {snap.lastSaved && idle ? (
        <Card style={{ marginTop: spacing.md }} accent={colors.teal}>
          <View style={styles.rowBetween}>
            <AppText variant="bodyStrong">{snap.lastSaved.tooShort ? 'Session not saved' : 'Session saved'}</AppText>
            <Pressable onPress={clearLastSaved} hitSlop={10} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          {!snap.lastSaved.tooShort ? (
            <>
              <AppText variant="caption" secondary>
                {formatDuration(snap.lastSaved.trackedSeconds)} classified across {snap.lastSaved.windowCount} windows
                {snap.lastSaved.source === 'replay'
                  ? ` · ${snap.lastSaved.replayCorrectWindows ?? 0}/${snap.lastSaved.windowCount} windows matched the recorded label (demo, excluded from stats)`
                  : ''}
                {snap.lastSaved.steps !== null ? ` · ${snap.lastSaved.steps} steps` : ''}
              </AppText>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Replay chooser */}
      {effectiveMode === 'replay' && idle ? (
        <>
          <SectionHeader title="Choose a recording" subtitle="Held-out UCI HAR test subjects" />
          <View style={{ gap: spacing.sm }}>
            {REPLAY_PROGRAMS.map((p) => {
              const on = p.id === replayId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setReplayId(p.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={[styles.replayRow, on && styles.replayRowOn]}>
                  <Ionicons name={p.id.startsWith('tour') ? 'albums-outline' : ACTIVITY_ICONS[p.labels[0]]} size={20} color={on ? colors.amber : colors.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong">{p.title}</AppText>
                    <AppText variant="caption" muted>
                      {p.description} · {(p.samples[0].length / p.sampleRateHz).toFixed(0)} s
                    </AppText>
                  </View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.amber : colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: spacing.md }}>
            <Segmented
              options={[
                { value: '1', label: 'Real time (1×)' },
                { value: '4', label: 'Fast (4×)' },
              ]}
              value={speed}
              onChange={setSpeed}
            />
          </View>
        </>
      ) : null}

      <Button label={details ? 'Hide sensor & model details' : 'Sensor & model details'} variant="ghost" icon={details ? 'chevron-up' : 'chevron-down'} onPress={() => setDetails((v) => !v)} style={{ marginTop: 22 }} />
      {details ? <>
        {current ? (
          <View style={styles.probBox}>
            <View style={styles.rowBetween}>
              <AppText variant="caption" secondary>
                Model probability (softmax)
              </AppText>
              <AppText variant="bodyStrong">{formatProb(topProb)}</AppText>
            </View>
            <ProgressBar value={topProb} color={colors.violet} height={6} />
            <AppText variant="caption" muted>
              {`${model.modelId}: held-out calibration error ${(model.metrics.test.expectedCalibrationError * 100).toFixed(1)}% on dataset subjects only — not calibrated for your phone or placement.${snap.useGyro ? '' : ' Accelerometer-only model.'}`}
            </AppText>
            {snap.mode === 'replay' && snap.replayTrueLabel ? (
              <View style={styles.truthRow}>
                <Ionicons
                  name={current.label === snap.replayTrueLabel ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={current.label === snap.replayTrueLabel ? colors.teal : colors.rose}
                />
                <AppText variant="caption" secondary>
                  Recorded label: {activityLabel(snap.replayTrueLabel)}
                </AppText>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
              <SourceTag source={snap.mode === 'replay' ? 'recorded' : 'measured'} label={snap.mode === 'replay' ? 'Recorded input' : 'Live sensor input'} />
              <SourceTag source="ml" />
            </View>
          </View>
        ) : null}


      {/* Live sensors */}
      <SectionHeader
        title={snap.mode === 'replay' && !idle ? 'Recorded signals' : 'Sensor signals'}
        subtitle={idle ? 'Signals appear while a session is running' : `Accelerometer ${snap.accRateHz.toFixed(0)} Hz · Gyroscope ${snap.gyroRateHz.toFixed(0)} Hz`}
      />
      <Card>
        <View style={styles.rowBetween}>
          <AppText variant="bodyStrong">Accelerometer</AppText>
          <AppText variant="caption" muted>
            g (incl. gravity)
          </AppText>
        </View>
        <AxisValues v={snap.acc} digits={3} />
        <LiveSignalChart series={snap.accHistory} range={2} />
        <View style={[styles.rowBetween, { marginTop: spacing.lg }]}>
          <AppText variant="bodyStrong">Gyroscope</AppText>
          <AppText variant="caption" muted>
            rad/s
          </AppText>
        </View>
        {availability.checked && !availability.gyroscope && snap.mode === 'live' ? (
          <Notice tone="warn">No gyroscope on this device. Live tracking uses the accelerometer-only model.</Notice>
        ) : (
          <>
            <AxisValues v={snap.gyro} digits={3} />
            <LiveSignalChart series={snap.gyroHistory} />
          </>
        )}
        <View style={{ marginTop: spacing.sm }}>
          <SourceTag source={effectiveMode === 'replay' ? 'recorded' : 'measured'} />
        </View>
      </Card>

      <Button label="Collect labelled movement data" icon="pulse-outline" variant="secondary" small onPress={() => router.push('/collect')} style={{ marginTop: spacing.lg }} />

      {/* Sensor health */}
      <SectionHeader title="Sensor health" actionLabel="Re-check" onAction={() => void recheckSensors()} />
      <Card>
        <SensorRow name="Accelerometer" ok={availability.accelerometer} checked={availability.checked} rate={!idle && snap.mode === 'live' ? snap.accRateHz : null} />
        <SensorRow name="Gyroscope" ok={availability.gyroscope} checked={availability.checked} rate={!idle && snap.mode === 'live' ? snap.gyroRateHz : null} />
        <SensorRow name="Pedometer (step counting)" ok={availability.pedometer} checked={availability.checked} rate={null} />
        <KeyValue k="Model in use" v={harModelFor(availability.gyroscope || snap.mode === 'replay').modelId} mono />
        <KeyValue k="Active sensor subscriptions" v={`${activeSubscriptions}`} mono />
        <KeyValue k="Window / step" v="128 / 64 samples @ 50 Hz" />
      </Card>

      {/* Current session breakdown */}
      {!idle && snap.trackedSeconds > 0 ? (
        <>
          <SectionHeader title="This session" />
          <Card>
            <BreakdownBar
              items={ACTIVITY_LIST.map((a) => ({ key: a.key, label: a.label, color: a.color, value: snap.durations[a.key] }))}
              formatValue={formatDuration}
            />
          </Card>
        </>
      ) : null}

      {!idle && snap.log.length > 0 ? (
        <>
          <SectionHeader title="Recent windows" subtitle="Smoothed label (majority of last 3 windows)" />
          <Card padded={false}>
            {snap.log.map((l, i) => (
              <View key={`${l.at}-${i}`} style={styles.logRow}>
                <AppText variant="mono" color={colors.textMuted} style={{ width: 56 }}>
                  {l.at.toFixed(1)}s
                </AppText>
                <View style={[styles.logDot, { backgroundColor: activityColor(l.label) }]} />
                <AppText variant="caption" style={{ flex: 1 }}>
                  {activityLabel(l.label)}
                </AppText>
                {l.trueLabel ? (
                  <Ionicons
                    name={l.trueLabel === l.label ? 'checkmark' : 'close'}
                    size={14}
                    color={l.trueLabel === l.label ? colors.teal : colors.rose}
                  />
                ) : null}
                <AppText variant="caption" muted style={{ width: 40, textAlign: 'right' }}>
                  {formatProb(l.probability)}
                </AppText>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* History */}
      <SectionHeader title="Session history" subtitle="Long-press a session to delete it" />
      {sessions.data && sessions.data.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          {sessions.data.map((s) => {
            const top = HAR_CLASSES.reduce((a, c) => (s.durations[c] > s.durations[a] ? c : a), HAR_CLASSES[0]);
            return (
              <Pressable key={s.id} onLongPress={() => confirmDelete(s)} style={styles.histRow} accessibilityHint="Long-press to delete">
                <View style={[styles.histIcon, { backgroundColor: `${activityColor(top)}22` }]}>
                  <Ionicons name={ACTIVITY_ICONS[top]} size={20} color={activityColor(top)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong">
                    {s.dateKey} · {formatClock(s.startedAt)}
                  </AppText>
                  <AppText variant="caption" muted>
                    {formatMinutes(s.trackedSeconds)} · mostly {activityLabel(top).toLowerCase()}
                    {s.steps !== null ? ` · ${s.steps} steps` : ''}
                  </AppText>
                </View>
                {s.source === 'replay' ? <Pill label="Demo" color={colors.amber} /> : <Pill label="Live" color={colors.cyan} />}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Card>
          <EmptyState compact icon="time-outline" title="No sessions yet" body="Completed tracking sessions and demo replays will appear here." />
        </Card>
      )}
      <AppText variant="caption" muted style={{ marginTop: spacing.lg }}>
        {`Deployed model ${HAR_MODEL.modelId}: ${(HAR_MODEL.metrics.test.accuracy * 100).toFixed(1)}% accuracy / ${HAR_MODEL.metrics.test.macroF1.toFixed(3)} macro-F1 on 9 held-out UCI HAR subjects.`}
      </AppText>
      </> : null}
    </Screen>
  );
}

/** Never show a model probability as a certain 100%. */
function formatProb(p: number): string {
  if (p >= 0.995) return '>99%';
  if (p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
}

function AxisValues({ v, digits }: { v: { x: number; y: number; z: number } | null; digits: number }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const axes: { k: 'x' | 'y' | 'z'; c: string }[] = [
    { k: 'x', c: colors.cyan },
    { k: 'y', c: colors.violet },
    { k: 'z', c: colors.teal },
  ];
  return (
    <View style={styles.axes}>
      {axes.map((a) => (
        <View key={a.k} style={styles.axis}>
          <AppText variant="micro" color={a.c}>
            {a.k.toUpperCase()}
          </AppText>
          <AppText variant="mono">{v ? v[a.k].toFixed(digits) : '—'}</AppText>
        </View>
      ))}
    </View>
  );
}

function SensorRow({ name, ok, checked, rate }: { name: string; ok: boolean; checked: boolean; rate: number | null }) {
  const styles = useStyles(makeStyles);
  const status = !checked ? 'off' : !ok ? 'error' : rate !== null && rate < 30 ? 'warn' : 'ok';
  return (
    <View style={styles.sensorRow}>
      <StatusDot status={status} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {name}
      </AppText>
      <AppText variant="caption" muted>
        {!checked ? 'Checking…' : !ok ? 'Not available' : rate !== null ? `${rate.toFixed(0)} Hz` : 'Available'}
      </AppText>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  movementStage: { alignItems: 'center', gap: 22, paddingVertical: 32 },
  owlRing: { width: 236, height: 236, borderRadius: 118, borderWidth: 1, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  predHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  predBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.lg },
  predIcon: { width: 84, height: 84, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  probBox: { marginTop: spacing.lg, gap: spacing.sm, backgroundColor: c.surfaceAlt, padding: spacing.md, borderRadius: radii.md },
  truthRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  controls: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  replayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: 56,
  },
  replayRowOn: { borderColor: c.amber, backgroundColor: c.amberSoft },
  axes: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.sm },
  axis: { flex: 1, backgroundColor: c.bgElevated, borderRadius: radii.sm, padding: spacing.sm, gap: 2 },
  sensorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
  },
  histIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
