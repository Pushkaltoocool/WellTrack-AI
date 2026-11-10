/**
 * Local notifications (work in Expo Go; no push server). Wren owns every scheduled
 * notification, so each sync cancels and re-creates the full set.
 */
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { Exam, Preferences } from '@/types/domain';

import { CHECKIN_CATEGORY, checkInActions, planReminders } from './schedule';

const CHANNEL_ID = 'reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function notificationPermission(ask: boolean): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!ask || !current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Returns the channel to use, or undefined (system default) if it can't be created. */
async function ensureChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Reminders', importance: AndroidImportance.DEFAULT });
    return CHANNEL_ID;
  } catch (e) {
    console.warn('[reminders] channel', e);
    return undefined;
  }
}

async function ensureCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY,
      checkInActions(Platform.OS).map((a) => ({ ...a, options: { opensAppToForeground: true } })));
  } catch (e) {
    console.warn('[reminders] category', e);
  }
}

export async function syncReminders(prefs: Preferences, exams: Exam[]): Promise<number> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  const plan = planReminders(prefs, exams);
  if (!plan.length || !(await notificationPermission(false))) return 0;
  const channelId = await ensureChannel();
  await ensureCategories();
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { url: r.url }, ...(r.category ? { categoryIdentifier: r.category } : {}) },
      trigger:
        r.trigger.kind === 'daily'
          ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: r.trigger.hour, minute: r.trigger.minute, channelId }
          : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.trigger.date, channelId },
    });
  }
  return plan.length;
}

export const scheduledCount = async () => (await Notifications.getAllScheduledNotificationsAsync()).length;
