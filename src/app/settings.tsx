import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Linking, Platform, StyleSheet, Switch, TextInput, View } from 'react-native';

import { AccountCard, AppearanceCard, CoachSettingsCard, JournalHealthCard, RemindersCard, SecurityCard, useRestoreFromFile } from '@/components/settings/SettingsCards';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { KeyValue, Notice, SectionHeader, StatusDot } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { SourceTag } from '@/components/ui/SourceTag';
import { STEP_HISTORY_SUPPORTED, requestStepHistoryPermission } from '@/features/activity/stepHistory';
import { useTracker } from '@/features/activity/TrackerProvider';
import { scheduledCount } from '@/features/reminders/reminders';
import { useAccount } from '@/services/cloud/AccountProvider';
import { deleteCloudData } from '@/services/cloud/backup';
import { useData, useDbQuery } from '@/services/database/DataProvider';
import { clearAllData, getSchemaVersion, tableCounts } from '@/services/database/db';
import { exportAll } from '@/services/database/repositories';
import { HAR_MODEL, HAR_MODEL_ACC_ONLY } from '@/services/ml/harModel';
import { STRESS_MODEL } from '@/services/ml/stressModel';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { radii, spacing, type Palette } from '@/theme/tokens';
import { DEFAULT_PREFERENCES } from '@/types/domain';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const PRIVACY_URL = 'https://welltrackai-128b4.web.app/privacy.html';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, updatePrefs, invalidate, reloadPrefs } = useData();
  const { availability, recheckSensors, activeSubscriptions, snap, discard } = useTracker();
  const [name, setName] = useState(prefs.displayName);
  const [busy, setBusy] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [modelDetails, setModelDetails] = useState(false);
  const [diagnostics, setDiagnostics] = useState(false);

  // Keep the input in sync if the stored name changes elsewhere (e.g. after a data reset).
  const [syncedName, setSyncedName] = useState(prefs.displayName);
  if (prefs.displayName !== syncedName) {
    setSyncedName(prefs.displayName);
    setName(prefs.displayName);
  }

  const restoreFromFile = useRestoreFromFile();
  const account = useAccount();
  const signedIn = !!account.user;
  const diag = useDbQuery(async (d) => ({ version: await getSchemaVersion(d), counts: await tableCounts(d), reminders: await scheduledCount().catch(() => null) }), []);

  const toggleStepHistory = async (on: boolean) => {
    if (on && !(await requestStepHistoryPermission())) {
      Alert.alert('Motion & Fitness access needed', 'Allow it in Settings → Privacy & Security → Motion & Fitness, then try again.');
      return;
    }
    await updatePrefs({ stepHistoryEnabled: on });
  };

  const adjust = (key: 'activeMinutesGoal' | 'sleepGoalHours', delta: number, min: number, max: number) =>
    updatePrefs({ [key]: Math.min(max, Math.max(min, prefs[key] + delta)) });

  const onExport = async () => {
    setBusy('export');
    try {
      const data = await exportAll(db);
      const file = new File(Paths.cache, `welltrack-export-${Date.now()}.json`);
      file.create();
      await file.write(JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export Wren data' });
      } else {
        Alert.alert('Export saved', `Sharing is not available on this device. The file was written to:\n${file.uri}`);
      }
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = () =>
    Alert.alert(
      'Delete all data?',
      signedIn
        ? 'This permanently removes every check-in, session, goal, exam, coach conversation and preference on this phone, and clears your account’s cloud backup. Your account itself stays (delete it from the Account screen). This cannot be undone.'
        : 'This permanently removes every check-in, tracking session, goal, exam, coach conversation and preference stored on this device. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              if (snap.status !== 'idle') discard();
              await clearAllData(db);
              if (account.user) await deleteCloudData(account.user.uid).catch(() => undefined);
              await reloadPrefs();
              invalidate();
              router.replace('/onboarding');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );

  const t = HAR_MODEL.metrics.test;
  const ta = HAR_MODEL_ACC_ONLY.metrics.test;

  return (
    <Screen back title="Settings">
      <AccountCard />
      <SectionHeader quiet title="You" />
      <Card>
        <AppText variant="caption" secondary>
          Display name
        </AppText>
        <View style={styles.row}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            maxLength={40}
            accessibilityLabel="Display name"
          />
          <Button label="Save" small onPress={() => updatePrefs({ displayName: name.trim() })} disabled={name.trim() === prefs.displayName} />
        </View>
        <Stepper
          label="Daily active-minutes goal"
          value={`${prefs.activeMinutesGoal} min`}
          onMinus={() => adjust('activeMinutesGoal', -5, 5, 180)}
          onPlus={() => adjust('activeMinutesGoal', 5, 5, 180)}
        />
        <Stepper
          label="Sleep goal"
          value={`${prefs.sleepGoalHours} h`}
          onMinus={() => adjust('sleepGoalHours', -0.5, 5, 10)}
          onPlus={() => adjust('sleepGoalHours', 0.5, 5, 10)}
        />
      </Card>

      <SectionHeader quiet title="Appearance" />
      <AppearanceCard />
      <SectionHeader quiet title="Reminders" />
      <RemindersCard />

      <SectionHeader quiet title="AI, journal & health" />
      <CoachSettingsCard />
      <View style={{ height: 12 }} />
      <JournalHealthCard />

      <SectionHeader quiet title="Motion" />
      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">Prediction smoothing</AppText>
            <AppText variant="caption" muted>
              Majority vote over the last 3 windows (≈3.8 s) to reduce flicker. Applies to new sessions.
            </AppText>
          </View>
          <Switch
            value={prefs.smoothingEnabled}
            onValueChange={(v) => updatePrefs({ smoothingEnabled: v })}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Prediction smoothing"
          />
        </View>
        <Button label="Open demo / replay mode" icon="play-circle-outline" variant="secondary" small onPress={() => router.push('/activity?mode=replay')} style={{ marginTop: spacing.md }} />
        <Button label="Collect labelled movement data" icon="pulse-outline" variant="secondary" small onPress={() => router.push('/collect')} style={{ marginTop: spacing.sm }} />
        <Button label={`Research sharing: ${prefs.researchRecordingsConsentAt || prefs.researchDailyConsentAt ? 'on' : 'off'}`} icon="shield-checkmark-outline" variant="secondary" small onPress={() => router.push('/research')} style={{ marginTop: spacing.sm }} />
      </Card>

      <SectionHeader quiet title="Sensors" actionLabel="Re-check" onAction={() => void recheckSensors()} />
      <Card>
        {[
          ['Accelerometer', availability.accelerometer],
          ['Gyroscope', availability.gyroscope],
          ['Pedometer', availability.pedometer],
        ].map(([n, ok]) => (
          <View key={String(n)} style={styles.sensorRow}>
            <StatusDot status={!availability.checked ? 'off' : ok ? 'ok' : 'error'} />
            <AppText variant="caption" style={{ flex: 1 }}>
              {n}
            </AppText>
            <AppText variant="caption" muted>
              {!availability.checked ? 'Checking…' : ok ? 'Available' : 'Not available'}
            </AppText>
          </View>
        ))}
        {STEP_HISTORY_SUPPORTED ? (
          <View style={[styles.switchRow, { marginTop: spacing.md }]}>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">All-day step history</AppText>
              <AppText variant="caption" muted>
                Reads daily step totals (last 7 days) from your iPhone’s motion coprocessor. Stored on this device only.
              </AppText>
            </View>
            <Switch
              value={prefs.stepHistoryEnabled}
              onValueChange={(v) => void toggleStepHistory(v)}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
              accessibilityLabel="All-day step history"
            />
          </View>
        ) : null}
        <AppText variant="caption" muted style={{ marginTop: spacing.sm }}>
          {Platform.OS === 'ios'
            ? 'Heart rate, HRV and Apple Health are not accessed — they need a development build, not Expo Go.'
            : 'All-day step history, heart rate and Health Connect are not accessed — on Android they need a development build, not Expo Go.'}
        </AppText>
      </Card>

      <SectionHeader quiet title="How Wren estimates things" />
      <Card>
        <View style={{ gap: 8 }}>
          <AppText variant="bodyStrong">Activity recognition</AppText>
          <AppText variant="caption" secondary>Recognises walking, stairs, sitting, standing and lying down from motion. Trained on the UCI HAR dataset and runs on this phone.</AppText>
          <AppText variant="caption" muted>{`${pct(t.accuracy)} accuracy on held-out dataset subjects. Real-world accuracy can differ.`}</AppText>
          <View style={styles.divider} />
          <AppText variant="bodyStrong">Stress risk</AppText>
          <AppText variant="caption" secondary>An experimental estimate using your study and sleep hours. Its training labels are rule-derived, so it is not a clinical assessment.</AppText>
          <AppText variant="caption" color={colors.amber}>Model installed · experimental</AppText>
          <View style={styles.divider} />
          <AppText variant="bodyStrong">Suggestions</AppText>
          <AppText variant="caption" secondary>Simple rules, such as suggesting a steady bedtime after short sleep. Each one tells you why it appeared.</AppText>
        </View>
        <Button label={modelDetails ? 'Hide model details' : 'View model details'} variant="ghost" small onPress={() => setModelDetails((v) => !v)} />
      </Card>
      {modelDetails ? <View style={{ gap: 16, marginTop: 16 }}>
      
      <Card>
        <View style={styles.rowBetween}>
          <AppText variant="heading">Activity recognition</AppText>
          <SourceTag source="ml" label="Loaded" />
        </View>
        <KeyValue k="Model ID" v={HAR_MODEL.modelId} mono />
        <KeyValue k="Type" v={`Multinomial logistic regression (C=${String(HAR_MODEL.hyperparameters.C)})`} />
        <KeyValue k="Features" v={`${HAR_MODEL.featureNames.length} time/frequency features from 6 channels`} />
        <KeyValue k="Held-out accuracy" v={pct(t.accuracy)} />
        <KeyValue k="Held-out macro-F1" v={t.macroF1.toFixed(3)} />
        <KeyValue k="Macro precision / recall" v={`${t.macroPrecision.toFixed(3)} / ${t.macroRecall.toFixed(3)}`} />
        <KeyValue k="Calibration error (ECE)" v={pct(t.expectedCalibrationError)} />
        <KeyValue k="Evaluation" v="Official UCI HAR split: 9 unseen test subjects, 2,947 windows" />
        <KeyValue k="Dataset" v={`${String(HAR_MODEL.dataset.name)} (${String(HAR_MODEL.dataset.license)})`} />
        <KeyValue k="Trained" v={`${HAR_MODEL.trainedAt} · scikit-learn ${HAR_MODEL.sklearnVersion}`} />
        <KeyValue k="Fallback (no gyroscope)" v={`${HAR_MODEL_ACC_ONLY.modelId}: ${pct(ta.accuracy)} acc, F1 ${ta.macroF1.toFixed(3)}`} />
        <Button
          label={showComparison ? 'Hide model comparison' : 'Show model comparison'}
          variant="ghost"
          small
          icon="git-compare-outline"
          onPress={() => setShowComparison((s) => !s)}
        />
        {showComparison ? (
          <View style={styles.table}>
            {Object.entries(HAR_MODEL.metrics.comparison).map(([k, v]) => (
              <KeyValue key={k} k={k} v={`acc ${pct(v.accuracy)} · F1 ${v.macroF1.toFixed(3)}`} />
            ))}
            <AppText variant="caption" muted style={{ marginTop: spacing.sm }}>
              RBF-SVM scored highest but needs thousands of support vectors and has no native probabilities; logistic
              regression was deployed as the best accuracy-to-size trade-off (18 KB).
            </AppText>
          </View>
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <View style={styles.rowBetween}>
          <AppText variant="heading">Stress-risk estimate</AppText>
          <SourceTag source="experimental" />
        </View>
        <KeyValue k="Model ID" v={STRESS_MODEL.modelId} mono />
        <KeyValue k="Type" v="Decision tree (depth 3)" />
        <KeyValue k="Inputs" v="Study hours, sleep hours" />
        <KeyValue k="Dataset" v={`${STRESS_MODEL.dataset.name}`} />
        <KeyValue k="Licence" v={STRESS_MODEL.dataset.license} />
        <KeyValue k="Status" v="Experimental — labels are rule-derived" />
        <View style={{ marginTop: spacing.sm }}>
          <Notice tone="warn">{STRESS_MODEL.dataset.labelProvenance}</Notice>
        </View>
      </Card>

      </View> : null}

      <SectionHeader quiet title="Privacy & security" />
      <SecurityCard />
      <Card style={{ marginTop: 16 }}>
        <AppText variant="caption" secondary>
          Your journal lives in a database on this phone. An account is optional: if you sign in, a private backup is kept in
          your account and only you can read it. The AI coach only sends a summary when you chat with it and have agreed. There
          are no ads, analytics or tracking SDKs. Motion sensors are read only during a session you start, and only per-session
          summaries are saved. Wren is a wellness tool, not a medical device.
        </AppText>
        <Button label="Privacy policy" small variant="ghost" icon="document-text-outline" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </Card>

      <SectionHeader quiet title="Your data" />
      <Card>
        <View style={{ gap: spacing.sm }}>
          <Button label="Export data (JSON)" icon="share-outline" variant="secondary" onPress={onExport} loading={busy === 'export'} />
          <Button label="Restore from a file" icon="download-outline" variant="secondary" onPress={() => void restoreFromFile()} />
          <Button label="Delete all data" icon="trash-outline" variant="danger" onPress={onDelete} loading={busy === 'delete'} testID="delete-all" />
        </View>
      </Card>

      <Button label={diagnostics ? 'Hide diagnostics' : 'App diagnostics'} variant="ghost" small onPress={() => setDiagnostics((v) => !v)} style={{ marginTop: 24 }} />
      {diagnostics ? <Card>
        <KeyValue k="App version" v={Constants.expoConfig?.version ?? 'unknown'} />
        <KeyValue k="Expo SDK" v={Constants.expoConfig?.sdkVersion ?? 'unknown'} />
        <KeyValue k="Runtime" v={isRunningInExpoGo() ? 'Expo Go' : String(Constants.executionEnvironment)} />
        <KeyValue k="Platform" v={`${Platform.OS} ${String(Platform.Version)}`} />
        <KeyValue k="Device" v={`${Device.manufacturer ?? ''} ${Device.modelName ?? ''}${Device.isDevice ? '' : ' (emulator)'}`.trim()} />
        <KeyValue k="Database schema" v={`v${diag.data?.version ?? '…'}`} />
        <KeyValue k="Scheduled reminders" v={diag.data?.reminders === null || diag.data?.reminders === undefined ? 'unknown' : String(diag.data.reminders)} mono />
        <KeyValue k="Account" v={account.user ? `signed in · backup ${account.backupStatus}` : 'not signed in'} />
        {diag.data
          ? Object.entries(diag.data.counts).map(([k, v]) => <KeyValue key={k} k={`rows: ${k}`} v={String(v)} mono />)
          : null}
        <KeyValue k="Sampling" v="50 Hz requested, resampled by timestamp" />
        <KeyValue k="Window" v="2.56 s (128 samples), 50% overlap" />
        <KeyValue k="All-day activity" v={prefs.allDayActivity ? 'on (OS motion history)' : 'off'} />
        <KeyValue k="Background model" v={prefs.backgroundModel ? 'on (Android service)' : 'off'} />
        <KeyValue k="Raw sensor storage" v="Only labelled recordings you make in Collect data" />
        <KeyValue k="Tracker status" v={`${snap.status} (${snap.mode})`} />
        <KeyValue k="Active sensor subscriptions" v={String(activeSubscriptions)} mono />
        <KeyValue k="Onboarding complete" v={String(prefs.onboardingComplete)} />
        <Button
          label="Replay onboarding"
          variant="ghost"
          small
          icon="refresh"
          onPress={async () => {
            await updatePrefs({ onboardingComplete: DEFAULT_PREFERENCES.onboardingComplete });
            router.replace('/onboarding');
          }}
        />
      </Card> : null}
    </Screen>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stepper}>
      <AppText variant="bodyStrong">
        {label}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Button label="−" small variant="secondary" onPress={onMinus} accessibilityHint={`Decrease ${label}`} />
        <AppText variant="bodyStrong" style={{ minWidth: 64, textAlign: 'center' }}>{value}</AppText>
        <Button label="+" small variant="secondary" onPress={onPlus} accessibilityHint={`Increase ${label}`} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  divider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: 6 },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: c.bgElevated,
    borderWidth: 1,
    borderColor: c.borderStrong,
    color: c.text,
    paddingHorizontal: spacing.md,
    fontSize: 15,
  },
  stepper: { alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  sensorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  table: { marginTop: spacing.sm },
});
