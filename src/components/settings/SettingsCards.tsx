/** Settings sections for accounts, reminders, privacy & security and the AI coach. */
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { Alert, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { notificationPermission } from '@/features/reminders/reminders';
import { formatTime, parseTime } from '@/features/reminders/schedule';
import { authenticate, canUseAppLock } from '@/features/security/AppLock';
import { timeAgo } from '@/lib/dates';
import { AI_ENABLED } from '@/services/ai/llm';
import { useAccount } from '@/services/cloud/AccountProvider';
import { BackupFormatError, exportSummary, parseExport } from '@/services/database/backupFormat';
import { useData } from '@/services/database/DataProvider';
import { importAll } from '@/services/database/repositories';
import { Segmented } from '@/components/ui/misc';
import { useStyles, useTheme, type ThemeMode } from '@/theme/ThemeProvider';
import { type Palette } from '@/theme/tokens';
import { healthAvailability, requestHealthAuthorization } from '@/features/health';
import type { Preferences } from '@/types/domain';

export function AccountCard() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const account = useAccount();
  if (!account.enabled) return null;
  const u = account.user;
  const status = account.backupStatus;
  return (
    <Card onPress={() => router.push('/account')} accessibilityLabel="Account">
      <View style={styles.row}>
        <View style={[styles.avatar, !u && { backgroundColor: colors.surfaceAlt }]}>
          {u ? (
            <AppText variant="heading" color={colors.textOnAccent}>{(u.displayName || u.email || '?').slice(0, 1).toUpperCase()}</AppText>
          ) : (
            <Ionicons name="person-outline" size={22} color={colors.text} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{u ? u.email ?? 'Signed in' : 'Sign in or create an account'}</AppText>
          <AppText variant="caption" secondary>
            {!u
              ? 'Optional. Back up your journal and restore it on a new phone.'
              : status === 'error'
                ? 'Backup needs attention'
                : status === 'off'
                  ? 'Automatic backup is off'
                  : account.lastBackup
                    ? `Backed up ${timeAgo(account.lastBackup.exportedAt)}`
                    : 'Setting up your backup…'}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>
    </Card>
  );
}

function ToggleRow({ title, body, value, onChange, label }: { title: string; body: string; value: boolean; onChange: (v: boolean) => void; label: string }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1, gap: 3 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" secondary>{body}</AppText>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.teal, false: colors.borderStrong }} thumbColor="#FFFFFF" accessibilityLabel={label} />
    </View>
  );
}

function TimeButton({ value, onChange, label }: { value: string; onChange: (hhmm: string) => void; label: string }) {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const { hour, minute } = parseTime(value);
  const date = new Date(2000, 0, 1, hour, minute);
  const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (Platform.OS === 'ios') {
    return <DateTimePicker value={date} mode="time" display="compact" onChange={(_, d) => d && onChange(toHHMM(d))} themeVariant={dark ? 'dark' : 'light'} accentColor={colors.teal} accessibilityLabel={label} />;
  }
  return (
    <Pressable
      onPress={() => DateTimePickerAndroid.open({ value: date, mode: 'time', onChange: (e, d) => e.type === 'set' && d && onChange(toHHMM(d)) })}
      style={styles.timePill}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatTime(value)}`}>
      <AppText variant="bodyStrong">{formatTime(value)}</AppText>
    </Pressable>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [{ value: 'system', label: 'System' }, { value: 'light', label: 'Dawn' }, { value: 'dark', label: 'Dusk' }];

export function AppearanceCard() {
  const { mode, setMode } = useTheme();
  return (
    <Card>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <AppText variant="bodyStrong">Theme</AppText>
          <AppText variant="caption" secondary>Dawn is light, Dusk is dark for night-time writing. System follows your phone.</AppText>
        </View>
        <Segmented options={THEME_OPTIONS} value={mode} onChange={setMode} />
      </View>
    </Card>
  );
}

export function RemindersCard() {
  const styles = useStyles(makeStyles);
  const { prefs, updatePrefs } = useData();
  const enable = async (patch: Partial<Preferences>) => {
    const turningOn = Object.values(patch).some((v) => v === true);
    if (turningOn && !(await notificationPermission(true))) {
      Alert.alert('Notifications are off', 'Allow notifications for WellTrack in your phone’s Settings to get reminders.');
      return;
    }
    await updatePrefs(patch);
  };
  return (
    <Card>
      <View style={{ gap: 16 }}>
        <ToggleRow title="Daily check-in" body="A gentle nudge to log how your day went." value={prefs.checkInReminder} onChange={(v) => void enable({ checkInReminder: v })} label="Daily check-in reminder" />
        {prefs.checkInReminder ? (
          <View style={styles.timeRow}>
            <AppText variant="caption" secondary>Remind me at</AppText>
            <TimeButton value={prefs.checkInReminderTime} onChange={(t) => void updatePrefs({ checkInReminderTime: t })} label="Check-in reminder time" />
          </View>
        ) : null}
        <ToggleRow title="Wind-down" body="A cue to put screens away before bed." value={prefs.windDownReminder} onChange={(v) => void enable({ windDownReminder: v })} label="Wind-down reminder" />
        {prefs.windDownReminder ? (
          <View style={styles.timeRow}>
            <AppText variant="caption" secondary>Remind me at</AppText>
            <TimeButton value={prefs.windDownReminderTime} onChange={(t) => void updatePrefs({ windDownReminderTime: t })} label="Wind-down reminder time" />
          </View>
        ) : null}
        <ToggleRow title="Exams & deadlines" body="The evening before each date you add." value={prefs.examReminders} onChange={(v) => void enable({ examReminders: v })} label="Exam reminders" />
        <Button label="Manage exams & deadlines" small variant="secondary" icon="calendar-outline" onPress={() => router.push('/exams')} />
      </View>
    </Card>
  );
}

export function SecurityCard() {
  const { prefs, updatePrefs } = useData();
  const toggle = async (on: boolean) => {
    if (on) {
      const can = await canUseAppLock();
      if (!can.ok) return Alert.alert('Can’t turn on app lock', can.reason);
      if (!(await authenticate('Confirm to turn on app lock'))) return;
    }
    await updatePrefs({ appLock: on });
  };
  return (
    <Card>
      <ToggleRow
        title="App lock"
        body={Platform.OS === 'ios' ? 'Require Face ID, Touch ID or your passcode to open WellTrack.' : 'Require your fingerprint, face or screen lock to open WellTrack.'}
        value={prefs.appLock}
        onChange={(v) => void toggle(v)}
        label="App lock"
      />
    </Card>
  );
}

export function CoachSettingsCard() {
  const styles = useStyles(makeStyles);
  const { prefs, updatePrefs } = useData();
  if (!AI_ENABLED) return null;
  const consented = !!prefs.coachConsentAt;
  return (
    <Card>
      <View style={{ gap: 14 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="bodyStrong">Wren, your AI coach</AppText>
          <AppText variant="caption" secondary>
            {consented
              ? 'On. Your messages and a summary of your last 14 days are sent to the AI provider when you chat.'
              : 'Off. Nothing is sent to an AI provider until you start a conversation and agree.'}
          </AppText>
        </View>
        {consented ? (
          <ToggleRow title="Share check-in notes" body="Lets Wren read the few words you write each day." value={prefs.coachIncludeNotes} onChange={(v) => void updatePrefs({ coachIncludeNotes: v })} label="Share check-in notes with Wren" />
        ) : null}
        <View style={styles.buttons}>
          <Button label={consented ? 'Open Wren' : 'Meet Wren'} small icon="chatbubble-ellipses-outline" onPress={() => router.push('/coach')} />
          {consented ? <Button label="Turn off" small variant="ghost" onPress={() => void updatePrefs({ coachConsentAt: null })} /> : null}
        </View>
      </View>
    </Card>
  );
}

/** Journal AI reading and Apple Health — both off until the user opts in. */
export function JournalHealthCard() {
  const { prefs, updatePrefs } = useData();
  const health = healthAvailability();
  return (
    <Card>
      <View style={{ gap: 14 }}>
        {AI_ENABLED ? (
          <ToggleRow
            title="Let Wren read journal entries"
            body={prefs.journalAiConsentAt ? 'On. Entry text is sent to the AI provider to name feelings and ask follow-up questions.' : 'Off. Entries are read on your phone with a simpler keyword method.'}
            value={prefs.journalAiConsentAt !== null}
            onChange={(v) => void updatePrefs({ journalAiConsentAt: v ? Date.now() : null })}
            label="Let Wren read journal entries"
          />
        ) : null}
        {health === 'available' ? (
          <ToggleRow
            title="Apple Health"
            body="Read sleep, steps, active energy, mindful minutes and time in daylight for Trends. Read-only."
            value={prefs.healthKitEnabled}
            onChange={async (v) => {
              if (v && !(await requestHealthAuthorization())) return;
              await updatePrefs({ healthKitEnabled: v });
            }}
            label="Use Apple Health data"
          />
        ) : (
          <AppText variant="caption" secondary>
            {health === 'expo-go' ? 'Apple Health is available in the full iPhone app (not in Expo Go).' : 'Apple Health is iPhone-only. Trends use your check-ins and motion sensor instead.'}
          </AppText>
        )}
      </View>
    </Card>
  );
}

/** Restore from a JSON file made by "Export data". Replaces everything on this device after confirmation. */
export function useRestoreFromFile() {
  const { db, reloadPrefs, invalidate } = useData();
  return async () => {
    // File.pickFileAsync grants read access to the picked file (a document-picker cache copy is not readable in Expo Go).
    const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', '*/*'] });
    if (picked.canceled || !picked.result) return;
    let data;
    try {
      data = parseExport(JSON.parse(await picked.result.text()));
    } catch (e) {
      console.warn('[restore]', e);
      Alert.alert('Can’t restore this file', e instanceof BackupFormatError ? e.message : 'This file isn’t a readable WellTrack export.');
      return;
    }
    const s = exportSummary(data);
    Alert.alert(
      'Replace your data?',
      `This file has ${s.checkIns} check-ins, ${s.sessions} sessions and ${s.goals} goals (${s.total} entries, exported ${new Date(data.exportedAt).toLocaleDateString()}). Everything currently on this phone will be replaced.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            try {
              const n = await importAll(db, data);
              await reloadPrefs();
              invalidate();
              Alert.alert('Restored', `${n} entries restored.`);
            } catch (e) {
              Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };
}

const makeStyles = (c: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -6 },
  timePill: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: c.surfaceAlt, justifyContent: 'center' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
