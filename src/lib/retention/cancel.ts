import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** Marks a scheduled notification as a retention notification, so show reminders and these never cancel each other. */
export const RETENTION_KIND = 'retention';

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

/** Cancels every scheduled retention notification (the kill switch, a toggle turned off, or the metro being switched off). Returns how many. */
export async function cancelRetentionNotifications(): Promise<number> {
  if (!supported) return 0;
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const mine = all.filter((n) => n.content.data?.kind === RETENTION_KIND);
    for (const n of mine) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    return mine.length;
  } catch {
    return 0;
  }
}
