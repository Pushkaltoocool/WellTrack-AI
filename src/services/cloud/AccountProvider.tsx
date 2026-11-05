/**
 * Account state (Firebase Auth) and automatic cloud backup. Backups run 15 s after the last
 * local write and when the app goes to the background, only while signed in with backup on.
 */
import * as Device from 'expo-device';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useData } from '@/services/database/DataProvider';
import { userRecordCount } from '@/services/database/repositories';

import { FIREBASE_ENABLED, firebaseAuth } from '../firebase/app';
import { deleteCurrentUser, reauthenticate } from '../firebase/auth';
import { backupToCloud, cloudErrorMessage, deleteCloudData, fetchBackupMeta, restoreFromCloud, type BackupMeta } from './backup';

export type BackupStatus = 'off' | 'idle' | 'pending' | 'running' | 'error';
export type LinkResult = { kind: 'uploaded' } | { kind: 'restored'; records: number } | { kind: 'conflict'; cloud: BackupMeta; localRecords: number };

interface AccountContextValue {
  enabled: boolean;
  user: User | null;
  initializing: boolean;
  backupStatus: BackupStatus;
  lastBackup: BackupMeta | null;
  backupError: string | null;
  backupNow: () => Promise<void>;
  restoreNow: () => Promise<number | null>;
  /** After a fresh sign-in: upload, restore into an empty device, or report a conflict for the user to resolve. */
  linkAfterSignIn: () => Promise<LinkResult>;
  deleteAccount: (password: string | null) => Promise<void>;
  /** Re-reads the Firebase user (e.g. after email verification). */
  refresh: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);
const DEBOUNCE_MS = 15_000;
const deviceName = () => [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'This device';

export function AccountProvider({ children }: { children: ReactNode }) {
  const { db, prefs, version, invalidate, reloadPrefs } = useData();
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(FIREBASE_ENABLED);
  const [backupStatus, setBackupStatus] = useState<BackupStatus>('off');
  const [lastBackup, setLastBackup] = useState<BackupMeta | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [userTick, setUserTick] = useState(0);
  const running = useRef<Promise<void> | null>(null);
  const backedUpVersion = useRef<number | null>(null);
  // Restores bump the data version; skip the backup that would otherwise echo it straight back.
  const skipVersion = useRef<number | null>(null);

  useEffect(() => {
    if (!FIREBASE_ENABLED) return;
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u);
      setInitializing(false);
    });
  }, []);

  const uid = user?.uid ?? null;
  const autoBackup = !!uid && prefs.cloudBackup;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    fetchBackupMeta(uid)
      .then((m) => {
        if (!cancelled) setLastBackup(m);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const runBackup = useCallback(async () => {
    if (!uid) return;
    if (running.current) return running.current;
    const v = version;
    setBackupStatus('running');
    running.current = (async () => {
      try {
        const meta = await backupToCloud(db, uid, deviceName());
        backedUpVersion.current = v;
        setLastBackup(meta);
        setBackupError(null);
        setBackupStatus('idle');
      } catch (e) {
        console.warn('[backup]', e);
        setBackupError(cloudErrorMessage(e));
        setBackupStatus('error');
      } finally {
        running.current = null;
      }
    })();
    return running.current;
  }, [db, uid, version]);

  const onBackupDue = useEffectEvent(() => void runBackup());

  // Debounced automatic backup after local changes.
  useEffect(() => {
    if (!autoBackup) return;
    if (backedUpVersion.current === version) return;
    if (skipVersion.current === version) {
      backedUpVersion.current = version;
      return;
    }
    const pending = setTimeout(() => setBackupStatus((s) => (s === 'running' ? s : 'pending')), 0);
    const t = setTimeout(onBackupDue, DEBOUNCE_MS);
    return () => {
      clearTimeout(pending);
      clearTimeout(t);
    };
  }, [autoBackup, version]);

  // Flush immediately when the app is backgrounded.
  useEffect(() => {
    if (!autoBackup) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' && backedUpVersion.current !== version) onBackupDue();
    });
    return () => sub.remove();
  }, [autoBackup, version]);

  const restoreNow = useCallback(async () => {
    if (!uid) return null;
    const n = await restoreFromCloud(db, uid);
    await reloadPrefs();
    skipVersion.current = version + 1;
    invalidate();
    return n;
  }, [db, uid, version, reloadPrefs, invalidate]);

  const linkAfterSignIn = useCallback(async (): Promise<LinkResult> => {
    const u = firebaseAuth().currentUser;
    if (!u) throw new Error('You are not signed in.');
    const [cloud, localRecords] = await Promise.all([fetchBackupMeta(u.uid), userRecordCount(db)]);
    if (!cloud) {
      const meta = await backupToCloud(db, u.uid, deviceName());
      backedUpVersion.current = version;
      setLastBackup(meta);
      return { kind: 'uploaded' };
    }
    if (localRecords === 0) {
      const records = (await restoreFromCloud(db, u.uid)) ?? 0;
      await reloadPrefs();
      skipVersion.current = version + 1;
      invalidate();
      setLastBackup(cloud);
      return { kind: 'restored', records };
    }
    return { kind: 'conflict', cloud, localRecords };
  }, [db, version, reloadPrefs, invalidate]);

  const deleteAccount = useCallback(async (password: string | null) => {
    const u = firebaseAuth().currentUser;
    if (!u) return;
    await reauthenticate(password);
    await deleteCloudData(u.uid);
    await deleteCurrentUser();
    setLastBackup(null);
    setBackupStatus('off');
  }, []);

  const refresh = useCallback(() => {
    const u = firebaseAuth().currentUser;
    if (!u) return;
    u.reload()
      .then(() => {
        setUser(firebaseAuth().currentUser);
        setUserTick((t) => t + 1);
      })
      .catch(() => undefined);
  }, []);

  const value: AccountContextValue = {
    enabled: FIREBASE_ENABLED,
    user,
    initializing,
    backupStatus: !autoBackup ? 'off' : backupStatus === 'off' ? 'idle' : backupStatus,
    lastBackup,
    backupError,
    backupNow: runBackup,
    restoreNow,
    linkAfterSignIn,
    deleteAccount,
    refresh,
  };
  void userTick; // forces a re-render after user.reload() (same User object, new fields)
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used inside <AccountProvider>');
  return ctx;
}
