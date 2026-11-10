/**
 * Account backup in Firestore. Layout (all readable/writable only by the owner, see firestore.rules):
 *   users/{uid}                 { backup: BackupMeta }
 *   users/{uid}/backup/{part}   { key, index, rows }   — one document per table chunk (< 1 MiB each)
 * SQLite on the device stays the source of truth; the cloud copy is a full snapshot.
 */
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

import { withdrawAllDays, withdrawAllRecordings } from '@/features/research/researchUpload';
import { chunkRows, EXPORT_APP_ID, parseExport, type WellTrackExport } from '@/services/database/backupFormat';
import type { Db } from '@/services/database/db';
import { exportAll, importAll } from '@/services/database/repositories';
import { BACKUP_TABLES } from '@/services/database/schema';

import { firestore } from '../firebase/app';

export interface BackupMeta {
  exportedAt: string;
  schemaVersion: number;
  device: string;
  counts: Record<string, number>;
  parts: string[];
}

type Row = Record<string, unknown>;

export function cloudErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'permission-denied') return 'The cloud refused this backup. The server’s security rules may not be deployed yet.';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'You appear to be offline. Wren will try again later.';
  if (code === 'resource-exhausted') return 'The cloud backup quota is used up for today. Your data is safe on this device.';
  if (code === 'unauthenticated') return 'Please sign in again to back up.';
  return e instanceof Error && e.message ? e.message : 'Backup failed.';
}

const userDoc = (uid: string) => doc(firestore(), 'users', uid);
const partsCol = (uid: string) => collection(firestore(), 'users', uid, 'backup');

export async function fetchBackupMeta(uid: string): Promise<BackupMeta | null> {
  const snap = await getDoc(userDoc(uid));
  const meta = snap.exists() ? (snap.data().backup as BackupMeta | undefined) : undefined;
  return meta?.parts ? meta : null;
}

export async function backupToCloud(db: Db, uid: string, device: string): Promise<BackupMeta> {
  const data = await exportAll(db);
  const parts: string[] = [];
  const counts: Record<string, number> = {};
  const writes: { id: string; body: Row }[] = [
    { id: 'preferences', body: { key: 'preferences', index: 0, preferences: data.preferences } },
  ];
  parts.push('preferences');
  for (const key of Object.keys(BACKUP_TABLES) as (keyof typeof BACKUP_TABLES)[]) {
    const rows = data[key] ?? [];
    counts[key] = rows.length;
    chunkRows(rows).forEach((chunk, i) => {
      const id = `${key}_${i}`;
      parts.push(id);
      writes.push({ id, body: { key, index: i, rows: chunk } });
    });
  }
  // Firestore batches cap at 500 writes; backups are far smaller, but commit in groups to be safe.
  let group = writeBatch(firestore());
  let ops = 0;
  for (const w of writes) {
    group.set(doc(partsCol(uid), w.id), w.body);
    if (++ops % 400 === 0) {
      await group.commit();
      group = writeBatch(firestore());
    }
  }
  if (ops % 400 !== 0) await group.commit();
  const meta: BackupMeta = { exportedAt: data.exportedAt, schemaVersion: data.schemaVersion ?? 0, device, counts, parts };
  await setDoc(userDoc(uid), { backup: meta, updatedAt: serverTimestamp() }, { merge: true });
  // Remove chunks left over from a larger previous backup.
  const existing = await getDocs(partsCol(uid));
  const keep = new Set(parts);
  await Promise.all(existing.docs.filter((d) => !keep.has(d.id)).map((d) => deleteDoc(d.ref)));
  return meta;
}

export async function downloadBackup(uid: string): Promise<WellTrackExport | null> {
  const meta = await fetchBackupMeta(uid);
  if (!meta) return null;
  const snaps = await getDocs(partsCol(uid));
  const byId = new Map(snaps.docs.map((d) => [d.id, d.data()]));
  const assembled: Record<string, unknown> = { app: EXPORT_APP_ID, exportedAt: meta.exportedAt, schemaVersion: meta.schemaVersion };
  for (const id of meta.parts) {
    const part = byId.get(id);
    if (!part) throw new Error('Your cloud backup is incomplete. Try backing up again from your other device.');
    if (id === 'preferences') {
      assembled.preferences = part.preferences ?? {};
      continue;
    }
    const key = String(part.key);
    assembled[key] = [...((assembled[key] as Row[] | undefined) ?? []), ...((part.rows as Row[]) ?? [])];
  }
  return parseExport(assembled);
}

export async function restoreFromCloud(db: Db, uid: string): Promise<number | null> {
  const data = await downloadBackup(uid);
  if (!data) return null;
  return importAll(db, data);
}

/** Deletes every document the app stored for this user. */
export async function deleteCloudData(uid: string): Promise<void> {
  // Research contributions go with the account. Before the research rules are deployed nothing can
  // have been uploaded, and reading the collections is denied — that must not block the deletion.
  const tolerateDenied = (e: unknown) => {
    if ((e as { code?: string } | null)?.code !== 'permission-denied') throw e;
  };
  await withdrawAllRecordings(uid).catch(tolerateDenied);
  await withdrawAllDays(uid).catch(tolerateDenied);
  const parts = await getDocs(partsCol(uid));
  await Promise.all(parts.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(userDoc(uid));
}
