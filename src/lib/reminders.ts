import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getShow } from './listingsStore';
import { planReminders } from './reminderPlan';
import { useApp } from './store';

export const REMINDER_CHANNEL = 'show-reminders';

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Show reminders',
    description: 'Reminders for shows you marked going',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/**
 * Ask for notification permission the first time someone marks a show going.
 * On Android 13+ the system prompt only appears once a channel exists.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  useApp.getState().setNotificationsAsked();
  return asked.granted;
}

export async function notificationsAllowed(): Promise<boolean> {
  if (!supported) return false;
  const p = await Notifications.getPermissionsAsync();
  return p.granted;
}

let chain: Promise<void> = Promise.resolve();

/**
 * Rebuild every scheduled reminder from the going list. Cheap enough to run on
 * every change and every app open, and it keeps reminders in step when a show
 * moves or is dropped.
 */
export function syncReminders(): Promise<void> {
  chain = chain.then(doSync).catch(() => {});
  return chain;
}

async function doSync() {
  if (!supported) return;
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await ensureChannel();
  await Notifications.cancelAllScheduledNotificationsAsync();
  const { decisions, reminderPrefs, reminderOff } = useApp.getState();
  const now = new Date();
  for (const [id, rec] of Object.entries(decisions)) {
    if (rec.decision !== 'going' || reminderOff[id]) continue;
    const show = getShow(id);
    if (!show) continue;
    for (const r of planReminders(show, reminderPrefs, now)) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: r.title,
          body: r.body,
          data: { url: `/show/${id}`, showId: id },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.at,
          channelId: REMINDER_CHANNEL,
        },
      });
    }
  }
}
