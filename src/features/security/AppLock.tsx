/**
 * Optional app lock: biometrics or the device passcode, on launch and after 30 s in the background.
 * While the app is inactive (app switcher) the content is covered so journal entries don't show.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Owl } from '@/components/ui/Owl';
import { useData } from '@/services/database/DataProvider';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';

const RELOCK_AFTER_MS = 30_000;

export async function canUseAppLock(): Promise<{ ok: boolean; reason?: string }> {
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  if (level === LocalAuthentication.SecurityLevel.NONE) {
    return { ok: false, reason: 'Set up a screen lock (passcode, fingerprint or face) on this phone first.' };
  }
  return { ok: true };
}

export async function authenticate(prompt = 'Unlock Wren'): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Cancel' });
  return res.success;
}

export function AppLock({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const { prefs } = useData();
  const enabled = prefs.appLock;
  const [locked, setLocked] = useState(enabled);
  const [covered, setCovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  // Turning the lock off in Settings unlocks immediately.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (!enabled) setLocked(false);
  }

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setCovered(false);
        if (backgroundedAt.current !== null && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) setLocked(true);
        backgroundedAt.current = null;
      } else {
        setCovered(true);
        if (s === 'background' && backgroundedAt.current === null) backgroundedAt.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = async () => {
    setError(null);
    try {
      if (await authenticate()) setLocked(false);
      else setError('Not unlocked. Try again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unlock failed.');
    }
  };

  const unlockOnShow = useRef(false);
  useEffect(() => {
    if (enabled && locked && !unlockOnShow.current) {
      unlockOnShow.current = true;
      const t = setTimeout(() => void unlock(), 300);
      return () => clearTimeout(t);
    }
    if (!locked) unlockOnShow.current = false;
  }, [enabled, locked]);

  const showCover = enabled && (locked || covered);
  return (
    <View style={{ flex: 1 }}>
      {children}
      {showCover ? (
        <View style={styles.cover} accessibilityViewIsModal>
          <Owl mood={3} pose={locked ? 'sleep' : 'calm'} size={140} />
          <AppText variant="title" align="center">Wren is locked</AppText>
          {locked ? (
            <>
              <AppText secondary align="center">Your journal stays private until you unlock.</AppText>
              <Button label="Unlock" icon="lock-open-outline" onPress={() => void unlock()} style={{ alignSelf: 'stretch' }} />
              {error ? <AppText variant="caption" color={colors.rose} align="center">{error}</AppText> : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: c.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 32,
  },
});
