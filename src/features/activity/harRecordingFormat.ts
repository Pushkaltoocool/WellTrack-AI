/**
 * Labelled sensor recordings for growing a personal HAR dataset.
 *
 * Samples are stored exactly as the live tracker sees them: resampled onto the 50 Hz grid by
 * SensorWindower, acceleration in g (gravity included, iOS sign-flipped to the Android/UCI
 * convention) and angular velocity in rad/s. A sensor gap starts a new `segment`; windows must
 * never span two segments. ml/har/collected.py reads this CSV layout — keep them in sync.
 */
import type { ActivityClass } from '@/types/domain';

export const PLACEMENTS = [
  { key: 'waist', label: 'Waist, sideways', hint: 'Clipped sideways at the belt, screen out — the training data’s position.' },
  { key: 'pocket', label: 'Trouser pocket', hint: 'Front trouser pocket, any way round.' },
  { key: 'hand', label: 'In hand', hint: 'Held as you normally would while using it.' },
  { key: 'bag', label: 'Bag or backpack', hint: 'Loose in a bag you are carrying or wearing.' },
] as const;
export type Placement = (typeof PLACEMENTS)[number]['key'];

export const CSV_HEADER =
  'recording_id,label,placement,platform,device,segment,t,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z';

/** Seconds dropped from the end of a manually stopped recording (taking the phone out to press Stop). */
export const MANUAL_STOP_TRIM_S = 3;
export const MAX_RECORDING_S = 30 * 60;

export interface RecordingMeta {
  id: string;
  label: ActivityClass;
  placement: Placement;
  platform: string;
  device: string;
  osVersion: string | null;
  appVersion: string | null;
  startedAt: number; // epoch ms
  /** Seconds of 50 Hz samples kept (after trimming). */
  durationSeconds: number;
  sampleCount: number;
  segments: number;
  useGyro: boolean;
  meanAccRateHz: number | null;
  meanGyroRateHz: number | null;
  stoppedBy: 'timer' | 'manual' | 'background';
  trimmedEndSeconds: number;
  /** When this recording finished uploading to the research dataset (ms); absent = not uploaded. */
  uploadedAt?: number | null;
}

/** Resampled 50 Hz samples, column-wise. */
export interface SampleBuffer {
  t: number[]; // seconds since the first sample
  segment: number[];
  ch: number[][]; // acc x/y/z (g), gyro x/y/z (rad/s)
}

export function emptyBuffer(): SampleBuffer {
  return { t: [], segment: [], ch: [[], [], [], [], [], []] };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Readable, filesystem-safe and unique per second, e.g. `20261103-142233-walking-pocket`. */
export function recordingId(startedAt: number, label: ActivityClass, placement: Placement): string {
  const d = new Date(startedAt);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${stamp}-${label.toLowerCase().replace(/_/g, '')}-${placement}`;
}

/** Keeps free-text device names from breaking the CSV. */
export function csvSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'unknown';
}

/** Drops the last `seconds` of samples. */
export function trimEnd(buf: SampleBuffer, seconds: number): SampleBuffer {
  const n = buf.t.length;
  if (n === 0 || seconds <= 0) return buf;
  const cutoff = buf.t[n - 1] - seconds;
  let keep = n;
  while (keep > 0 && buf.t[keep - 1] > cutoff) keep--;
  return { t: buf.t.slice(0, keep), segment: buf.segment.slice(0, keep), ch: buf.ch.map((c) => c.slice(0, keep)) };
}

export function segmentCount(buf: SampleBuffer): number {
  return new Set(buf.segment).size;
}

/** One CSV document (header + one row per sample). Gyro columns are empty when no gyroscope was used. */
export function recordingToCsv(meta: RecordingMeta, buf: SampleBuffer): string {
  const prefix = [meta.id, meta.label, meta.placement, meta.platform, csvSafe(meta.device)].join(',');
  const rows: string[] = [CSV_HEADER];
  for (let i = 0; i < buf.t.length; i++) {
    const acc = `${buf.ch[0][i].toFixed(5)},${buf.ch[1][i].toFixed(5)},${buf.ch[2][i].toFixed(5)}`;
    const gyro = meta.useGyro ? `${buf.ch[3][i].toFixed(5)},${buf.ch[4][i].toFixed(5)},${buf.ch[5][i].toFixed(5)}` : ',,';
    rows.push(`${prefix},${buf.segment[i]},${buf.t[i].toFixed(3)},${acc},${gyro}`);
  }
  return rows.join('\n') + '\n';
}

/** Parses one recording's CSV (as written by recordingToCsv) back into a sample buffer. */
export function csvToBuffer(csv: string): SampleBuffer {
  const buf = emptyBuffer();
  const lines = csv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(',');
    // recording_id,label,placement,platform,device,segment,t,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z
    buf.segment.push(Number(c[5]));
    buf.t.push(Number(c[6]));
    for (let k = 0; k < 6; k++) buf.ch[k].push(c[7 + k] === '' ? 0 : Number(c[7 + k]));
  }
  return buf;
}

/** Joins per-recording CSVs into one file with a single header. */
export function combineCsv(docs: string[]): string {
  const bodies = docs.map((d) => {
    const nl = d.indexOf('\n');
    return nl < 0 ? '' : d.slice(nl + 1);
  });
  return CSV_HEADER + '\n' + bodies.join('');
}
