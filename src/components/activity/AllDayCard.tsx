/**
 * "Your day" on the Movement screen: the OS motion history as a midnight-to-now strip with
 * minutes per type, the switch that turns it on, and (Android) Wren's own model running
 * in the background with today's estimate.
 */
import { Ionicons } from '@expo/vector-icons';
import { isRunningInExpoGo } from 'expo';
import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Switch, View } from 'react-native';

import { BreakdownBar } from '@/components/charts/Charts';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/misc';
import { SourceTag } from '@/components/ui/SourceTag';
import { ACTIVITY_LIST } from '@/features/activity/activityMeta';
import {
  backgroundModelSupported,
  BACKGROUND_PERIOD_S,
  BACKGROUND_WINDOW_S,
  disableAllDay,
  enableAllDay,
  motionSupported,
  setBackgroundModel,
  syncMotionHistory,
  todaySegments,
  type MotionActivitySample,
} from '@/features/motion/motionSync';
import { notificationPermission } from '@/features/reminders/reminders';
import { formatDuration, formatMinutes, todayKey } from '@/lib/dates';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { listBackgroundDays, type MotionKind } from '@/services/database/motionRepo';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';

const KINDS: { key: MotionKind; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { key: 'walking', label: 'Walking', icon: 'walk', color: '#2C8F7B' },
  { key: 'running', label: 'Running', icon: 'speedometer-outline', color: '#E8956B' },
  { key: 'cycling', label: 'Cycling', icon: 'bicycle', color: '#2F6F8F' },
  { key: 'automotive', label: 'In a vehicle', icon: 'bus-outline', color: '#7466C4' },
  { key: 'stationary', label: 'Still', icon: 'pause-circle-outline', color: '#A9B0C0' },
];
const colorOf = (k: string) => KINDS.find((x) => x.key === k)?.color ?? '#D9D4CC';

export function AllDayCard() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, updatePrefs, invalidate, version } = useData();
  const [fetched, setFetched] = useState<{ segments: MotionActivitySample[]; at: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = motionSupported();
  const background = useDbQuery((d) => listBackgroundDays(d, todayKey()), []);
  const today = background.data?.[0];

  useEffect(() => {
    if (!prefs.allDayActivity) return;
    let alive = true;
    void todaySegments().then((segments) => alive && setFetched({ segments, at: Date.now() }));
    return () => {
      alive = false;
    };
  }, [prefs.allDayActivity, version]);
  const segments = prefs.allDayActivity ? (fetched?.segments ?? null) : null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const status = await enableAllDay();
      if (status === 'granted') {
        await updatePrefs({ allDayActivity: true });
        await syncMotionHistory(db);
        invalidate();
      } else {
        Alert.alert('Motion access is off', `Allow ${Platform.OS === 'ios' ? 'Motion & Fitness' : 'Physical activity'} for Wren in Settings to see your day.`, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => void Linking.openSettings() },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    await disableAllDay();
    await updatePrefs({ allDayActivity: false });
  };

  const toggleBackground = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await notificationPermission(true); // Android 13+: the service's notification needs it
        const started = await setBackgroundModel(true);
        if (!started) return Alert.alert('Couldn’t start', 'Android didn’t allow the background service. Check that Wren can use physical activity and show notifications.');
      } else {
        await setBackgroundModel(false);
      }
      await updatePrefs({ backgroundModel: on });
    } finally {
      setBusy(false);
    }
  };

  if (!supported) {
    return <Card>
      <AppText variant="bodyStrong">All-day activity</AppText>
      <AppText variant="caption" secondary style={{ marginTop: 6 }}>
        {isRunningInExpoGo() || Platform.OS === 'web'
          ? 'Works in the App Store and Play Store builds: Wren reads your phone’s built-in motion history, so your whole day appears here without the app being open.'
          : 'This phone doesn’t provide a motion history. Live tracking below still works while the app is open.'}
      </AppText>
    </Card>;
  }

  if (!prefs.allDayActivity) {
    return <Card accent={colors.teal}>
      <View style={{ gap: 8 }}>
        <AppText variant="bodyStrong">See your whole day</AppText>
        <AppText variant="caption" secondary>
          Your phone’s motion chip already notes when you walk, run, cycle, ride or sit still, at almost no battery cost. Wren can read that history — no location, nothing leaves your phone unless you choose to contribute it.
        </AppText>
        <Button label="Turn on all-day activity" icon="sunny-outline" small loading={busy} onPress={() => void turnOn()} style={{ alignSelf: 'flex-start' }} />
      </View>
    </Card>;
  }

  const now = fetched?.at ?? 0;
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const span = Math.max(1, now - midnight);
  const minutes = new Map<MotionKind, number>();
  for (const s of segments ?? []) minutes.set(s.type, (minutes.get(s.type) ?? 0) + (s.endMs - s.startMs) / 60_000);

  return <View style={{ gap: spacing.md }}>
    <Card>
      <View style={styles.rowBetween}>
        <AppText variant="bodyStrong">Today so far</AppText>
        <AppText variant="caption" muted>midnight → now</AppText>
      </View>
      <View style={styles.strip} accessibilityLabel="Timeline of today's movement">
        {(segments ?? []).map((s, i) => (
          <View key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${((s.startMs - midnight) / span) * 100}%`, width: `${Math.max(0.4, ((s.endMs - s.startMs) / span) * 100)}%`, backgroundColor: colorOf(s.type) }} />
        ))}
      </View>
      <View style={styles.legend}>
        {KINDS.map((k) => (
          <View key={k.key} style={styles.legendItem}>
            <Ionicons name={k.icon} size={16} color={k.color} />
            <AppText variant="caption">{k.label}</AppText>
            <AppText variant="caption" muted>{formatMinutes((minutes.get(k.key) ?? 0) * 60)}</AppText>
          </View>
        ))}
      </View>
      {segments && segments.length === 0 ? <AppText variant="caption" muted style={{ marginTop: spacing.sm }}>Nothing recorded yet today. Carry your phone and check back.</AppText> : null}
      <View style={[styles.rowBetween, { marginTop: spacing.md }]}>
        <SourceTag source="measured" label="Phone motion history" />
        <Button label="Turn off" variant="ghost" small onPress={() => void turnOff()} />
      </View>
    </Card>

    {backgroundModelSupported() ? (
      <Card>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Wren’s model in the background</AppText>
            <AppText variant="caption" muted>
              {`Samples the motion sensors for ${BACKGROUND_WINDOW_S} s every ${BACKGROUND_PERIOD_S / 60} min, even with the app closed, and recognises stairs, sitting and lying down too. Shows a quiet notification while on.`}
            </AppText>
          </View>
          <Switch value={prefs.backgroundModel} onValueChange={(v) => void toggleBackground(v)} disabled={busy}
            trackColor={{ true: colors.teal, false: colors.borderStrong }} accessibilityLabel="Run the activity model in the background" />
        </View>
        {prefs.backgroundModel ? (
          today && today.windowCount > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <BreakdownBar items={ACTIVITY_LIST.map((a) => ({ key: a.key, label: a.label, color: a.color, value: today.durations[a.key] }))} formatValue={formatDuration} />
              <View style={{ marginTop: spacing.sm }}><SourceTag source="ml" label="On-device estimate" /></View>
            </View>
          ) : (
            <Notice>The first estimate appears after a few captures. Open the app later today.</Notice>
          )
        ) : null}
      </Card>
    ) : null}
  </View>;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  strip: { height: 22, borderRadius: radii.sm, backgroundColor: c.surfaceAlt, overflow: 'hidden', marginTop: spacing.md },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: '45%' },
});
