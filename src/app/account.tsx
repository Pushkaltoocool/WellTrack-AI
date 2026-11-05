import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Notice, Segmented } from '@/components/ui/misc';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { timeAgo } from '@/lib/dates';
import { useAccount, type LinkResult } from '@/services/cloud/AccountProvider';
import { cloudErrorMessage } from '@/services/cloud/backup';
import { useData } from '@/services/database/DataProvider';
import {
  appleSignInAvailable,
  authErrorMessage,
  googleSignInAvailable,
  isCancelled,
  providerIds,
  resendVerification,
  sendPasswordReset,
  signInWithApple,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
  validateSignUp,
} from '@/services/firebase/auth';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

type Mode = 'signin' | 'signup';

export default function AccountScreen() {
  const account = useAccount();
  if (!account.enabled) {
    return (
      <Screen back title="Account">
        <Notice tone="info" title="Accounts aren’t set up in this build">
          WellTrack works fully on this device without an account.
        </Notice>
      </Screen>
    );
  }
  if (account.initializing) return <Screen back title="Account"><AppText secondary>Loading…</AppText></Screen>;
  return account.user ? <SignedIn /> : <SignedOut />;
}

function SignedOut() {
  const styles = useStyles(makeStyles);
  const account = useAccount();
  const { prefs, updatePrefs, reloadPrefs } = useData();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState(prefs.displayName);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [apple, setApple] = useState(false);
  const google = googleSignInAvailable();

  useEffect(() => {
    let alive = true;
    appleSignInAvailable().then((ok) => alive && setApple(ok));
    return () => {
      alive = false;
    };
  }, []);

  const afterSignIn = async (displayName: string | null) => {
    if (displayName && !prefs.displayName) await updatePrefs({ displayName: displayName.split(' ')[0] });
    let result: LinkResult;
    try {
      result = await account.linkAfterSignIn();
    } catch (e) {
      Alert.alert('Signed in', `Your account is ready, but the first backup didn’t finish. ${cloudErrorMessage(e)}`);
      return;
    }
    if (result.kind === 'conflict') {
      const cloudDate = new Date(result.cloud.exportedAt);
      Alert.alert(
        'You have data in two places',
        `Your account has a backup from ${result.cloud.device} (${cloudDate.toLocaleDateString()}), and this phone has ${result.localRecords} entries of its own. Which should WellTrack keep?`,
        [
          {
            text: 'Use the cloud backup',
            onPress: () => void account.restoreNow().catch((e) => Alert.alert('Restore failed', authErrorMessage(e))),
          },
          { text: 'Keep this phone’s data', onPress: () => void account.backupNow() },
        ],
        { cancelable: false },
      );
    } else if (result.kind === 'restored') {
      Alert.alert('Welcome back', `Restored ${result.records} entries from your account.`);
    }
    if (from === 'onboarding') {
      // A restore already marks onboarding complete; a brand-new account finishes it here.
      await reloadPrefs();
      await updatePrefs({ onboardingComplete: true });
      router.replace('/home');
    } else if (router.canGoBack()) router.back();
  };

  const run = async (key: string, fn: () => Promise<{ displayName: string | null }>) => {
    setError(null);
    setBusy(key);
    try {
      const u = await fn();
      await afterSignIn(u.displayName);
    } catch (e) {
      if (!isCancelled(e)) setError(authErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    if (mode === 'signup') {
      const v = validateSignUp(name, email, password);
      if (v) return setError(v);
      return run('email', () => signUpWithEmail(name, email, password));
    }
    if (!email.trim() || !password) return setError('Enter your email and password.');
    return run('email', () => signInWithEmail(email, password));
  };

  const forgot = async () => {
    if (!email.trim()) return setError('Enter your email above, then tap “Forgot password?” again.');
    try {
      await sendPasswordReset(email);
      Alert.alert('Check your inbox', `If an account exists for ${email.trim()}, a reset link is on its way.`);
    } catch (e) {
      setError(authErrorMessage(e));
    }
  };

  return (
    <Screen back title={mode === 'signin' ? 'Welcome back' : 'Create your account'} subtitle="Optional. An account backs up your journal so you can restore it on a new phone.">
      <View style={styles.stack}>
        <Segmented<Mode>
          options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
        />
        {mode === 'signup' ? (
          <TextField label="First name (optional)" value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" maxLength={40} />
        ) : null}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          autoCapitalize="none"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          textContentType={mode === 'signup' ? 'newPassword' : 'password'}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
          onSubmitEditing={submit}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button label={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy === 'email'} disabled={!!busy && busy !== 'email'} />
        {mode === 'signin' ? <Button label="Forgot password?" variant="ghost" small onPress={forgot} /> : null}

        {google || apple ? <AppText variant="caption" muted align="center">or</AppText> : null}
        {apple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={27}
            style={{ height: 54 }}
            onPress={() => void run('apple', signInWithApple)}
          />
        ) : null}
        {google ? (
          <Button label="Continue with Google" icon="logo-google" variant="secondary" loading={busy === 'google'} onPress={() => void run('google', signInWithGoogle)} />
        ) : (
          <AppText variant="caption" muted align="center">Google and Apple sign-in arrive with the App Store and Play Store builds.</AppText>
        )}

        <Card style={{ marginTop: 8 }}>
          <View style={{ gap: 6 }}>
            <AppText variant="bodyStrong">What an account stores</AppText>
            <AppText variant="caption" secondary>
              A copy of your check-ins, journal entries, goals, sessions, exams and settings, readable only by you. Raw motion data never leaves your phone. You can delete your account and its backup at any time.
            </AppText>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

function SignedIn() {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const account = useAccount();
  const { prefs, updatePrefs } = useData();
  const user = account.user!;
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const usesPassword = providerIds(user).includes('password');

  const signOut = () =>
    Alert.alert('Sign out?', 'Your data stays on this phone. Backups pause until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await account.backupNow().catch(() => undefined);
          await signOutUser();
        },
      },
    ]);

  const restore = () =>
    Alert.alert('Restore from your account?', 'This replaces everything on this phone with your latest cloud backup.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        style: 'destructive',
        onPress: async () => {
          setBusy('restore');
          try {
            const n = await account.restoreNow();
            Alert.alert(n === null ? 'No backup yet' : 'Restored', n === null ? 'Your account has no backup to restore.' : `Restored ${n} entries.`);
          } catch (e) {
            Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const confirmDelete = async () => {
    setDeleteError(null);
    setBusy('delete');
    try {
      await account.deleteAccount(usesPassword ? password : null);
      Alert.alert('Account deleted', 'Your account and its cloud backup are gone. Your data is still on this phone; delete it in Settings if you like.');
      router.back();
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
      if (!isCancelled(e)) setDeleteError(code.startsWith('auth/') ? authErrorMessage(e) : `Your account was not deleted. ${cloudErrorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const status = account.backupStatus;
  const last = account.lastBackup;
  return (
    <Screen back title="Your account">
      <View style={styles.stack}>
        <Card>
          <View style={styles.profile}>
            <View style={styles.avatar}>
              <AppText variant="heading" color={colors.textOnAccent}>{(user.displayName || user.email || '?').slice(0, 1).toUpperCase()}</AppText>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong">{user.displayName || prefs.displayName || 'WellTrack member'}</AppText>
              <AppText variant="caption" secondary numberOfLines={1}>{user.email ?? 'Signed in'}</AppText>
            </View>
          </View>
          {usesPassword && !user.emailVerified ? (
            <View style={{ marginTop: 16, gap: 10 }}>
              <Notice tone="warn" title="Confirm your email">We sent a link to your inbox. Verifying lets you reset your password if you forget it.</Notice>
              <View style={styles.row}>
                <Button label="Resend link" small variant="secondary" onPress={() => resendVerification().then(() => Alert.alert('Sent', 'Check your inbox.')).catch((e) => Alert.alert('Could not send', authErrorMessage(e)))} />
                <Button label="I’ve verified" small variant="ghost" onPress={account.refresh} />
              </View>
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="bodyStrong">Automatic backup</AppText>
              <AppText variant="caption" secondary>Backs up shortly after each change and when you leave the app.</AppText>
            </View>
            <Switch
              value={prefs.cloudBackup}
              onValueChange={(v) => void updatePrefs({ cloudBackup: v })}
              trackColor={{ true: colors.teal, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Automatic backup"
            />
          </View>
          <View style={styles.statusRow}>
            <Ionicons
              name={status === 'error' ? 'cloud-offline-outline' : status === 'running' || status === 'pending' ? 'cloud-upload-outline' : 'cloud-done-outline'}
              size={18}
              color={status === 'error' ? colors.rose : colors.teal}
            />
            <AppText variant="caption" secondary style={{ flex: 1 }}>
              {status === 'running'
                ? 'Backing up…'
                : status === 'pending'
                  ? 'Changes waiting to back up'
                  : status === 'error'
                    ? account.backupError ?? 'Backup failed'
                    : last
                      ? `Last backup ${timeAgo(last.exportedAt)} from ${last.device}`
                      : 'No backup yet'}
            </AppText>
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Button label="Back up now" small icon="cloud-upload-outline" loading={status === 'running'} onPress={() => void account.backupNow()} />
            <Button label="Restore" small variant="secondary" loading={busy === 'restore'} onPress={restore} />
          </View>
        </Card>

        <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={signOut} />

        {!deleting ? (
          <Button label="Delete account" variant="danger" icon="trash-outline" onPress={() => setDeleting(true)} />
        ) : (
          <Card>
            <View style={{ gap: 12 }}>
              <AppText variant="bodyStrong" color={colors.rose}>Delete your account?</AppText>
              <AppText variant="caption" secondary>This permanently deletes your WellTrack account and its cloud backup. Data on this phone is kept unless you delete it in Settings.</AppText>
              {usesPassword ? <TextField label="Confirm with your password" value={password} onChangeText={setPassword} secure autoCapitalize="none" /> : null}
              {deleteError ? <Notice tone="danger">{deleteError}</Notice> : null}
              <View style={styles.row}>
                <Button label="Delete permanently" variant="danger" small loading={busy === 'delete'} onPress={() => void confirmDelete()} />
                <Button label="Cancel" variant="ghost" small onPress={() => setDeleting(false)} />
              </View>
            </View>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stack: { gap: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
});
