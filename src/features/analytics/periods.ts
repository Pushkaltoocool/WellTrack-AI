/**
 * Calendar periods for the Trends screen (week / month / year), their chart buckets and the
 * matching previous period for comparison. Pure date-key arithmetic in local time.
 */
import { addDays, dateKey, parseDateKey } from '@/lib/dates';

export type PeriodKind = 'week' | 'month' | 'year';

export interface Bucket {
  /** First and last date key in the bucket (inclusive). */
  from: string;
  to: string;
  /** Short axis label ("J", "15", "M"). Empty when the axis skips this bucket. */
  label: string;
}

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
  buckets: Bucket[];
  /** "This year", "Last month", "October", "Oct 12 – 18". */
  title: string;
  /** "2026", "October 2026", "2026". */
  subtitle: string;
  /** Index of the bucket that contains today, or -1. */
  currentBucket: number;
}

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ymd = (y: number, m: number, d: number) => dateKey(new Date(y, m, d));
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** The period of `kind` that is `offset` periods before (negative) the one containing `today`. */
export function periodFor(kind: PeriodKind, offset: number, today: string): Period {
  const t = parseDateKey(today);
  const within = (b: Bucket) => today >= b.from && today <= b.to;
  if (kind === 'year') {
    const y = t.getFullYear() + offset;
    const buckets = MONTH_LETTERS.map((label, m) => ({ from: ymd(y, m, 1), to: ymd(y, m, daysInMonth(y, m)), label }));
    return {
      kind, from: ymd(y, 0, 1), to: ymd(y, 11, 31), buckets,
      title: offset === 0 ? 'This year' : offset === -1 ? 'Last year' : String(y),
      subtitle: String(y), currentBucket: buckets.findIndex(within),
    };
  }
  if (kind === 'month') {
    const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
    const y = first.getFullYear();
    const m = first.getMonth();
    const n = daysInMonth(y, m);
    const buckets = Array.from({ length: n }, (_, i) => {
      const k = ymd(y, m, i + 1);
      return { from: k, to: k, label: i % 7 === 0 ? String(i + 1) : '' };
    });
    return {
      kind, from: ymd(y, m, 1), to: ymd(y, m, n), buckets,
      title: offset === 0 ? 'This month' : offset === -1 ? 'Last month' : MONTHS[m],
      subtitle: `${MONTHS[m]} ${y}`, currentBucket: buckets.findIndex(within),
    };
  }
  const start = addDays(today, -t.getDay() + offset * 7);
  const buckets = Array.from({ length: 7 }, (_, i) => {
    const k = addDays(start, i);
    return { from: k, to: k, label: DAY_LETTERS[i] };
  });
  const end = buckets[6].to;
  const s = parseDateKey(start);
  const e = parseDateKey(end);
  const range = `${SHORT_MONTHS[s.getMonth()]} ${s.getDate()} – ${s.getMonth() === e.getMonth() ? '' : `${SHORT_MONTHS[e.getMonth()]} `}${e.getDate()}`;
  return {
    kind, from: start, to: end, buckets,
    title: offset === 0 ? 'This week' : offset === -1 ? 'Last week' : range,
    subtitle: offset === 0 || offset === -1 ? range : String(e.getFullYear()), currentBucket: buckets.findIndex(within),
  };
}

/** Assigns dated rows to buckets and reduces each bucket with `reduce` (null when a bucket is empty). */
export function bucketize<T extends { dateKey: string }>(rows: T[], buckets: Bucket[], reduce: (rows: T[]) => number | null): (number | null)[] {
  return buckets.map((b) => {
    const inside = rows.filter((r) => r.dateKey >= b.from && r.dateKey <= b.to);
    return inside.length ? reduce(inside) : null;
  });
}

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** A short phrase for an average 1–5 mood. */
export function moodHeadline(avg: number | null): string {
  if (avg === null) return 'Nothing logged yet';
  if (avg < 1.8) return 'A rough stretch';
  if (avg < 2.6) return 'A heavier stretch';
  if (avg < 3.4) return 'A steady stretch';
  if (avg < 4.2) return 'A good stretch';
  return 'A bright stretch';
}
