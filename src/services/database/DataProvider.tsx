import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { ScreenBackground } from '@/components/ui/Screen';
import { useStyles, useTheme } from '@/theme/ThemeProvider';
import { spacing, type Palette } from '@/theme/tokens';
import { DEFAULT_PREFERENCES, type Preferences } from '@/types/domain';

import { getDb, type Db } from './db';
import { getPreferences, setPreferences } from './repositories';

interface DataContextValue {
  db: Db;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => Promise<void>;
  /** Monotonic counter bumped after every write; queries re-run when it changes. */
  version: number;
  invalidate: () => void;
  reloadPrefs: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [db, setDb] = useState<Db | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDb();
        const p = await getPreferences(d);
        if (!cancelled) {
          setPrefs(p);
          setDb(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const invalidate = useCallback(() => setVersion((v) => v + 1), []);

  const updatePrefs = useCallback(
    async (patch: Partial<Preferences>) => {
      if (!db) return;
      await setPreferences(db, patch);
      setPrefs((p) => ({ ...p, ...patch }));
      invalidate();
    },
    [db, invalidate],
  );

  const reloadPrefs = useCallback(async () => {
    if (!db) return;
    setPrefs(await getPreferences(db));
  }, [db]);

  if (error) {
    return (
      <View style={styles.center}>
        <ScreenBackground />
        <AppText variant="title">Storage unavailable</AppText>
        <AppText secondary align="center">
          WellTrack could not open its local database: {error}
        </AppText>
        <Button label="Try again" onPress={() => setAttempt((a) => a + 1)} />
      </View>
    );
  }
  if (!db) {
    return (
      <View style={styles.center}>
        <ScreenBackground />
        <ActivityIndicator color={colors.primary} size="large" />
        <AppText secondary>Preparing your data…</AppText>
      </View>
    );
  }
  return (
    <DataContext.Provider value={{ db, prefs, updatePrefs, version, invalidate, reloadPrefs }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/**
 * Runs an async database query, re-running when `deps` change, after any write
 * (data version bump) and whenever the screen regains focus.
 */
export function useDbQuery<T>(
  fn: (db: Db) => Promise<T>,
  deps: readonly unknown[] = [],
): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const { db, version } = useData();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // `loading` is derived: true until the query for the current request key has settled.
  const requestKey = `${version}:${tick}:${JSON.stringify(deps)}`;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const runQuery = useEffectEvent((d: Db) => fn(d));

  useEffect(() => {
    let cancelled = false;
    runQuery(db)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        console.warn('[useDbQuery]', e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [db, requestKey]);
  const loading = settledKey !== requestKey;

  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      setTick((t) => t + 1);
    }, []),
  );

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

const makeStyles = (c: Palette) => StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    backgroundColor: c.bg,
  },
});
