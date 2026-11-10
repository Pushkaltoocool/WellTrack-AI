/**
 * The portable Wren data format, shared by JSON export/import and cloud backup.
 * Pure (no database access) so it can be validated and unit-tested in isolation.
 */
import { DEFAULT_PREFERENCES, type Preferences } from '@/types/domain';

import { BACKUP_TABLES, SCHEMA_VERSION } from './schema';

/** Kept from the app's former name so existing exports and cloud backups stay readable. */
export const EXPORT_APP_ID = 'WellTrack AI';

type Row = Record<string, unknown>;

export type WellTrackExport = {
  exportedAt: string;
  app: string;
  schemaVersion?: number;
  preferences: Partial<Preferences>;
} & { -readonly [K in keyof typeof BACKUP_TABLES]?: Row[] };

export class BackupFormatError extends Error {}

/** Validates untrusted JSON (a picked file or a cloud document) and returns a typed export. */
export function parseExport(raw: unknown): WellTrackExport {
  if (!raw || typeof raw !== 'object') throw new BackupFormatError('This file is not a Wren export.');
  const d = raw as Row;
  if (d.app !== EXPORT_APP_ID) throw new BackupFormatError('This file was not exported by Wren.');
  const version = typeof d.schemaVersion === 'number' ? d.schemaVersion : 2;
  if (version > SCHEMA_VERSION) {
    throw new BackupFormatError(`This backup comes from a newer version of Wren (data v${version}). Update the app first.`);
  }
  const out: WellTrackExport = {
    exportedAt: typeof d.exportedAt === 'string' ? d.exportedAt : new Date(0).toISOString(),
    app: EXPORT_APP_ID,
    schemaVersion: version,
    preferences: d.preferences && typeof d.preferences === 'object' ? (d.preferences as Partial<Preferences>) : {},
  };
  for (const key of Object.keys(BACKUP_TABLES) as (keyof typeof BACKUP_TABLES)[]) {
    const v = d[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      throw new BackupFormatError(`The “${key}” section of this backup is damaged.`);
    }
    out[key] = v as Row[];
  }
  return out;
}

/** Keeps only known preference keys whose type matches the default; restored data is always past onboarding. */
export function sanitizePreferences(raw: Partial<Preferences> | undefined): Partial<Preferences> {
  const out: Record<string, unknown> = {};
  const defaults = DEFAULT_PREFERENCES as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(k in defaults)) continue;
    const def = defaults[k];
    const ok =
      def === null ? v === null || typeof v === 'number' : Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def;
    if (ok) out[k] = v;
  }
  out.onboardingComplete = true;
  return out as Partial<Preferences>;
}

/** Record counts per section, for confirmation dialogs. */
export function exportSummary(d: WellTrackExport): { checkIns: number; sessions: number; goals: number; total: number } {
  const len = (k: keyof typeof BACKUP_TABLES) => d[k]?.length ?? 0;
  const total = (Object.keys(BACKUP_TABLES) as (keyof typeof BACKUP_TABLES)[]).reduce((a, k) => a + len(k), 0);
  return { checkIns: len('checkins'), sessions: len('activitySessions'), goals: len('goals'), total };
}

const MAX_PART_BYTES = 600_000;

/** Splits rows into chunks whose JSON stays well under Firestore's 1 MiB document limit. */
export function chunkRows(rows: Row[], maxBytes = MAX_PART_BYTES): Row[][] {
  const chunks: Row[][] = [];
  let current: Row[] = [];
  let size = 0;
  for (const r of rows) {
    const s = JSON.stringify(r).length + 1;
    if (current.length && size + s > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(r);
    size += s;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
