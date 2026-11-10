import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { syncResearchDays } from '@/features/research/dailyFeatures';
import { syncPendingRecordings, withdrawAllDays, withdrawAllRecordings } from '@/features/research/researchUpload';
import { useAccount } from '@/services/cloud/AccountProvider';
import { cloudErrorMessage } from '@/services/cloud/backup';
import { useData } from '@/services/database/DataProvider';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

/** Opt-in consent for contributing sensor recordings and daily summaries to model training. */
export default function ResearchScreen() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { db, prefs, updatePrefs } = useData();
  const { user } = useAccount();
  const [recordings, setRecordings] = useState(!!prefs.researchRecordingsConsentAt);
  const [daily, setDaily] = useState(!!prefs.researchDailyConsentAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstTime = !prefs.researchRecordingsConsentAt && !prefs.researchDailyConsentAt;

  const save = async () => {
    if (!user) return;
    const withdrawing = (!!prefs.researchRecordingsConsentAt && !recordings) || (!!prefs.researchDailyConsentAt && !daily);
    const apply = async () => {
      setBusy(true);
      setError(null);
      try {
        if (prefs.researchRecordingsConsentAt && !recordings) await withdrawAllRecordings(user.uid);
        if (prefs.researchDailyConsentAt && !daily) await withdrawAllDays(user.uid);
        const now = Date.now();
        await updatePrefs({
          researchRecordingsConsentAt: recordings ? (prefs.researchRecordingsConsentAt ?? now) : null,
          researchDailyConsentAt: daily ? (prefs.researchDailyConsentAt ?? now) : null,
        });
        if (recordings) await syncPendingRecordings(user.uid);
        if (daily) await syncResearchDays(db, user.uid);
        router.back();
      } catch (e) {
        setError(`Your choice is saved on this phone, but the upload didn’t finish. ${cloudErrorMessage(e)} Wren will retry automatically.`);
      } finally {
        setBusy(false);
      }
    };
    if (!withdrawing) return void apply();
    Alert.alert('Stop sharing?', 'Everything you contributed in the turned-off category will be deleted from the research dataset. Recordings stay on this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop and delete', style: 'destructive', onPress: () => void apply() },
    ]);
  };

  return (
    <Screen back title="Help train Wren" subtitle="Wren’s activity model was trained on 30 people in a lab. Real recordings from students like you are how it gets better, and how it might one day notice stress before you do.">
      <View style={styles.stack}>
        <Choice icon="pulse-outline" tint={colors.teal} title="Labelled motion recordings" value={recordings} onChange={setRecordings}
          body="When you record an activity in Collect data: the accelerometer and gyroscope samples, the activity you chose, where the phone was, and your phone model and OS version." />
        <Choice icon="calendar-outline" tint={colors.peach} title="Daily summaries with your stress rating" value={daily} onChange={setDaily}
          body="Once a day: minutes walking, running and still from your phone’s motion history, the activity model’s estimate, your step count, and your check-in answers including stress and mood." />

        <Card>
          <View style={{ gap: 10 }}>
            <AppText variant="bodyStrong">What is never shared</AppText>
            <Bullet text="Your location. Wren only borrows it to keep a recording running with the screen locked, and throws every reading away." />
            <Bullet text="Journal entries, check-in notes, your name or email." />
            <Bullet text="Anything, until you switch a category on here." />
          </View>
        </Card>
        <Card>
          <View style={{ gap: 10 }}>
            <AppText variant="bodyStrong">How it’s used</AppText>
            <Bullet text="Stored in Wren’s cloud database under your account. The Wren developer downloads it to train new activity and stress models, which ship in app updates." />
            <Bullet text="Results are only ever reported as totals across many people." />
            <Bullet text="Turn a category off at any time to delete what you contributed. Deleting your account deletes it too." />
            <Bullet text="If you’re under 18, check with a parent or guardian before you agree." />
          </View>
        </Card>

        {error ? <Notice tone="warn">{error}</Notice> : null}
        <Button label={firstTime ? (recordings || daily ? 'Agree and contribute' : 'Not now') : 'Save'} onPress={() => (firstTime && !recordings && !daily ? router.back() : void save())} loading={busy} disabled={!user} />
        <AppText variant="caption" muted align="center">Consent version 1 · you can change this any time in Settings → Research.</AppText>
      </View>
    </Screen>
  );
}

function Choice({ icon, tint, title, body, value, onChange }: { icon: ComponentProps<typeof Ionicons>['name']; tint: string; title: string; body: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Card>
      <View style={styles.choiceHead}>
        <View style={[styles.icon, { backgroundColor: `${tint}22` }]}><Ionicons name={icon} size={20} color={tint} /></View>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>{title}</AppText>
        <Switch value={value} onValueChange={onChange} accessibilityLabel={title} trackColor={{ true: colors.teal, false: colors.border }} />
      </View>
      <AppText variant="caption" secondary style={{ marginTop: 10 }}>{body}</AppText>
    </Card>
  );
}

function Bullet({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Ionicons name="ellipse" size={6} color={colors.textMuted} style={{ marginTop: 8 }} />
      <AppText variant="caption" secondary style={{ flex: 1 }}>{text}</AppText>
    </View>
  );
}

const makeStyles = (_c: Palette) => StyleSheet.create({
  stack: { gap: 14 },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
