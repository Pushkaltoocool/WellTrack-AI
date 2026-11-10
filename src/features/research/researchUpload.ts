/**
 * Research contributions (opt-in, see app/research.tsx). Layout — kept in sync with
 * ml/har/fetch_firestore.py:
 *   users/{uid}/harRecordings/{recordingId}            RecordingMeta + encoding fields, complete flag
 *   users/{uid}/harRecordings/{recordingId}/chunks/NNN  { index, start, count, acc, gyro, segments }
 *   users/{uid}/researchDays/{YYYY-MM-DD}               daily activity summary + stress rating
 * Samples are int16 little-endian, interleaved x,y,z, stored as Firestore Bytes.
 */
import { Bytes, collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';

import { listRecordings, loadRecordingBuffer, setUploaded } from '@/features/activity/harRecordingStore';
import type { RecordingMeta, SampleBuffer } from '@/features/activity/harRecordingFormat';
import { firestore } from '@/services/firebase/app';

export const CONSENT_VERSION = 1;
export const SCHEMA_VERSION = 1;
const CHUNK_SAMPLES = 15_000; // 5 min at 50 Hz → ~90 KB per sensor, well under Firestore's 1 MiB
export const ACC_SCALE = 1 / 4096; // g per LSB (±8 g)
export const GYRO_SCALE = 1 / 1000; // rad/s per LSB (±32.7 rad/s)

const recordingsCol = (uid: string) => collection(firestore(), 'users', uid, 'harRecordings');

function encode(ch: number[][], from: number, to: number, scale: number): Bytes {
  const n = to - from;
  const view = new DataView(new ArrayBuffer(n * 3 * 2));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = Math.round(ch[k][from + i] / scale);
      view.setInt16((i * 3 + k) * 2, Math.max(-32768, Math.min(32767, Number.isFinite(v) ? v : 0)), true);
    }
  }
  return Bytes.fromUint8Array(new Uint8Array(view.buffer));
}

function runLength(segment: number[], from: number, to: number): { segment: number; count: number }[] {
  const out: { segment: number; count: number }[] = [];
  for (let i = from; i < to; i++) {
    const last = out[out.length - 1];
    if (last && last.segment === segment[i]) last.count++;
    else out.push({ segment: segment[i], count: 1 });
  }
  return out;
}

export async function uploadRecording(uid: string, meta: RecordingMeta, buf: SampleBuffer): Promise<void> {
  const ref = doc(recordingsCol(uid), meta.id);
  const n = buf.t.length;
  const chunkCount = Math.ceil(n / CHUNK_SAMPLES);
  const { uploadedAt: _local, ...fields } = meta;
  // Parent first (the rules check ownership through it), chunks next, `complete` last.
  await setDoc(ref, {
    ...fields,
    uid,
    schemaVersion: SCHEMA_VERSION,
    consentVersion: CONSENT_VERSION,
    complete: false,
    uploadedAt: serverTimestamp(),
    sampleRateHz: 50,
    chunkCount,
    encoding: 'int16le',
    accScale: ACC_SCALE,
    gyroScale: GYRO_SCALE,
  });
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SAMPLES;
    const end = Math.min(n, start + CHUNK_SAMPLES);
    await setDoc(doc(ref, 'chunks', String(i).padStart(3, '0')), {
      index: i,
      start,
      count: end - start,
      acc: encode(buf.ch.slice(0, 3), start, end, ACC_SCALE),
      gyro: meta.useGyro ? encode(buf.ch.slice(3, 6), start, end, GYRO_SCALE) : null,
      segments: runLength(buf.segment, start, end),
    });
  }
  await setDoc(ref, { complete: true, uploadedAt: serverTimestamp() }, { merge: true });
}

/** Uploads every local recording that hasn't been uploaded yet. Returns how many went up. */
export async function syncPendingRecordings(uid: string): Promise<number> {
  let sent = 0;
  for (const meta of await listRecordings()) {
    if (meta.uploadedAt) continue;
    const buf = await loadRecordingBuffer(meta.id);
    if (!buf || buf.t.length === 0) continue;
    await uploadRecording(uid, meta, buf);
    await setUploaded(meta, Date.now());
    sent++;
  }
  return sent;
}

async function deleteRecordingDoc(uid: string, id: string): Promise<void> {
  const ref = doc(recordingsCol(uid), id);
  const chunks = await getDocs(collection(ref, 'chunks'));
  await Promise.all(chunks.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(ref);
}

/** Removes one contributed recording from the research dataset. */
export const withdrawRecording = (uid: string, id: string) => deleteRecordingDoc(uid, id);

/** Withdraws every recording (consent revoked or account deleted) and marks local copies as not uploaded. */
export async function withdrawAllRecordings(uid: string): Promise<void> {
  const docs = await getDocs(recordingsCol(uid));
  for (const d of docs.docs) await deleteRecordingDoc(uid, d.id);
  for (const meta of await listRecordings()) if (meta.uploadedAt) await setUploaded(meta, null);
}

/** Deletes every daily research row. */
export async function withdrawAllDays(uid: string): Promise<void> {
  const docs = await getDocs(collection(firestore(), 'users', uid, 'researchDays'));
  for (let i = 0; i < docs.docs.length; i += 400) {
    const batch = writeBatch(firestore());
    for (const d of docs.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
}
