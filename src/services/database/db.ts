import * as SQLite from 'expo-sqlite';

import { MIGRATIONS, SCHEMA_VERSION, USER_TABLES } from './schema';

export type Db = SQLite.SQLiteDatabase;

export const DB_NAME = 'welltrack.db';

let dbPromise: Promise<Db> | null = null;

let txChain: Promise<unknown> = Promise.resolve();

/**
 * Runs a transaction exclusively. expo-sqlite's withTransactionAsync is not exclusive on a
 * shared connection, so overlapping transactions from different screens would conflict;
 * every write transaction in the app goes through this queue instead.
 */
export function transaction(db: Db, task: () => Promise<void>): Promise<void> {
  const run = txChain.then(
    () => db.withTransactionAsync(task),
    () => db.withTransactionAsync(task),
  );
  txChain = run.catch(() => undefined);
  return run;
}

export async function migrate(db: Db): Promise<number> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema v${version} is newer than this app (v${SCHEMA_VERSION}).`);
  }
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONS[version];
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
  return version;
}

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })().catch((e: unknown) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function getSchemaVersion(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Deletes every user record (keeps the schema). */
export async function clearAllData(db: Db): Promise<void> {
  await transaction(db, async () => {
    for (const t of USER_TABLES) await db.execAsync(`DELETE FROM ${t};`);
  });
}

export async function tableCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of USER_TABLES) {
    const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`);
    out[t] = r?.n ?? 0;
  }
  return out;
}
