/**
 * On-device storage for labelled HAR recordings: `<id>.csv` + `<id>.json` per recording in the
 * app's documents folder. Export joins them into one CSV, shared through the share sheet or
 * (Android) written into a folder the user picks. Nothing is uploaded.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { dateKey } from '@/lib/dates';

import { combineCsv, recordingToCsv, type RecordingMeta, type SampleBuffer } from './harRecordingFormat';

function recordingsDir(): Directory {
  const dir = new Directory(Paths.document, 'har-recordings');
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

async function writeText(file: File, text: string) {
  if (file.exists) file.delete();
  file.create();
  await file.write(text);
}

export async function saveRecording(meta: RecordingMeta, buf: SampleBuffer): Promise<void> {
  const dir = recordingsDir();
  await writeText(new File(dir, `${meta.id}.csv`), recordingToCsv(meta, buf));
  // Metadata last: a recording only appears in the list once its samples are on disk.
  await writeText(new File(dir, `${meta.id}.json`), JSON.stringify(meta));
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const metas: RecordingMeta[] = [];
  for (const entry of recordingsDir().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
    try {
      metas.push(JSON.parse(await entry.text()) as RecordingMeta);
    } catch {
      // skip unreadable metadata
    }
  }
  return metas.sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteRecording(id: string): void {
  const dir = recordingsDir();
  for (const name of [`${id}.json`, `${id}.csv`]) {
    const f = new File(dir, name);
    if (f.exists) f.delete();
  }
}

async function combinedCsv(ids: string[]): Promise<string> {
  const dir = recordingsDir();
  const docs: string[] = [];
  for (const id of ids) {
    const f = new File(dir, `${id}.csv`);
    if (f.exists) docs.push(await f.text());
  }
  return combineCsv(docs);
}

export function exportFileName(ids: string[]): string {
  return ids.length === 1 ? `welltrack-har-${ids[0]}.csv` : `welltrack-har-${dateKey(Date.now())}-${ids.length}rec.csv`;
}

/** Opens the share sheet with one CSV holding the given recordings. Returns false if sharing is unavailable. */
export async function shareRecordings(ids: string[]): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, exportFileName(ids));
  await writeText(file, await combinedCsv(ids));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export activity recordings' });
  return true;
}

/**
 * Android: asks for a folder (e.g. Downloads or a synced Drive folder) and writes the CSV there.
 * Returns the file name, or null if the picker was cancelled.
 */
export async function saveRecordingsToFolder(ids: string[]): Promise<string | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return null; // picker cancelled
  }
  const name = exportFileName(ids);
  const file = dir.createFile(name, 'text/csv');
  await file.write(await combinedCsv(ids));
  return name;
}
