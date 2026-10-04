import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Marks a scheduled notification as a retention notification, so show reminders and these never cancel each other. */
export const RETENTION_KIND = 'retention';
/** A test notification from Settings: it opens the deck like a real one but changes no counters and no history. */
export const RETENTION_TEST_KIND = 'retention-test';

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

/**
 * Cancels scheduled retention notifications (the kill switch, a toggle turned off, or the city being switched off).
 * With `type`, only that kind. Returns how many were cancelled.
 */
export async function cancelRetentionNotifications(type?: 'A' | 'B'): Promise<number> {
  if (!supported) return 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const mine = all.filter((n) => {
      const k = n.content.data?.kind;
      return (k === RETENTION_KIND || k === RETENTION_TEST_KIND) && (!type || n.content.data?.type === type);
    });
    for (const n of mine) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    return mine.length;
  } catch {
    return 0;
  }
}
