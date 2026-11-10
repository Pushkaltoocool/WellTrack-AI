/** Pure reminder planning (no native calls) so timing rules can be unit-tested. */
import { parseDateKey } from '@/lib/dates';
import type { Exam, Preferences } from '@/types/domain';

export interface PlannedReminder {
  id: string;
  title: string;
  body: string;
  url: string;
  /** Notification category whose action buttons appear on this reminder. */
  category?: string;
  trigger: { kind: 'daily'; hour: number; minute: number } | { kind: 'date'; date: Date };
}

export function parseTime(hhmm: string, fallback = { hour: 20, minute: 30 }): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return fallback;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : fallback;
}

export function formatTime(hhmm: string): string {
  const { hour, minute } = parseTime(hhmm);
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const CHECKIN_CATEGORY = 'checkin';
const MOOD_BUTTONS = ['Rough', 'Low', 'Okay', 'Good', 'Great'];

/**
 * Mood buttons on the daily check-in reminder. Android shows at most three actions, so it gets the
 * middle of the scale; the check-in opens with that mood picked and it can still be changed.
 */
export function checkInActions(platform: string): { identifier: string; buttonTitle: string }[] {
  const moods = platform === 'android' ? [2, 3, 4] : [1, 2, 3, 4, 5];
  return moods.map((m) => ({ identifier: `mood-${m}`, buttonTitle: MOOD_BUTTONS[m - 1] }));
}

/** Where a notification tap should go: a mood button opens the check-in with that mood chosen. */
export function urlForResponse(actionIdentifier: string, url: unknown): string | null {
  const m = /^mood-([1-5])$/.exec(actionIdentifier);
  if (m) return `/checkin?mood=${m[1]}`;
  return typeof url === 'string' && url.startsWith('/') ? url : null;
}

export const EXAM_EVE_HOUR = 18;
const EXAM_HORIZON_DAYS = 60;

export function planReminders(
  prefs: Pick<Preferences, 'checkInReminder' | 'checkInReminderTime' | 'windDownReminder' | 'windDownReminderTime' | 'examReminders'>,
  exams: Pick<Exam, 'id' | 'title' | 'dateKey'>[],
  now: Date = new Date(),
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  if (prefs.checkInReminder) {
    out.push({
      id: 'checkin',
      title: 'How was today?',
      body: 'A one-minute check-in helps Wren spot what makes your days better.',
      url: '/checkin',
      category: CHECKIN_CATEGORY,
      trigger: { kind: 'daily', ...parseTime(prefs.checkInReminderTime) },
    });
  }
  if (prefs.windDownReminder) {
    out.push({
      id: 'winddown',
      title: 'Time to wind down',
      body: 'Screens down, lights low. A few slow breaths can help you settle.',
      url: '/breathing',
      trigger: { kind: 'daily', ...parseTime(prefs.windDownReminderTime, { hour: 22, minute: 30 }) },
    });
  }
  if (prefs.examReminders) {
    const horizon = now.getTime() + EXAM_HORIZON_DAYS * 86_400_000;
    for (const e of exams) {
      const eve = parseDateKey(e.dateKey);
      eve.setDate(eve.getDate() - 1);
      eve.setHours(EXAM_EVE_HOUR, 0, 0, 0);
      if (eve.getTime() <= now.getTime() || eve.getTime() > horizon) continue;
      out.push({
        id: `exam-${e.id}`,
        title: `Tomorrow: ${e.title}`,
        body: 'Pack what you need tonight and protect your sleep. You’ve prepared for this.',
        url: '/exams',
        trigger: { kind: 'date', date: eve },
      });
    }
  }
  return out;
}
