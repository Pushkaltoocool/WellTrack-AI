import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { todayKey } from '@/lib/dates';
import { useData } from '@/services/database/DataProvider';
import { listExams } from '@/services/database/repositories';

import { syncReminders } from './reminders';
import { urlForResponse } from './schedule';

/** Keeps scheduled reminders in step with preferences and exams, and opens the right screen on tap. */
export function useReminderSync() {
  const { db, prefs, version } = useData();
  const { checkInReminder, checkInReminderTime, windDownReminder, windDownReminderTime, examReminders } = prefs;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      listExams(db, todayKey())
        .then((exams) => (cancelled ? 0 : syncReminders(prefs, exams)))
        .catch((e) => console.warn('[reminders]', e));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `prefs` is read for the reminder fields listed; `version` catches exam edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, checkInReminder, checkInReminderTime, windDownReminder, windDownReminderTime, examReminders]);

  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      if (r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined);
      const url = urlForResponse(r.actionIdentifier, r.notification.request.content.data?.url);
      if (url) router.push(url as Href);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
