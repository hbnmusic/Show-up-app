/**
 * Creates the retention notifications on the phone. Nothing is sent to a server: the system's own scheduler shows them.
 * Each kind has its own Android channel, so the person can also silence one of them in the system settings.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotifType, Plan } from './planner';
import { cancelRetentionNotifications, RETENTION_KIND, RETENTION_TEST_KIND } from './cancel';

export const CHANNEL_A = 'new-shows';
export const CHANNEL_B = 'tonight-shows';
export const channelFor = (t: NotifType) => (t === 'A' ? CHANNEL_A : CHANNEL_B);

const supported = Platform.OS === 'android' || Platform.OS === 'ios';

export async function ensureRetentionChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_A, {
    name: 'New shows',
    description: 'A heads-up when new shows are added in your city',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_B, {
    name: 'Shows tonight',
    description: 'A heads-up about shows tonight near you',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** True when the system allows notifications (never asks). */
export async function permissionGranted(): Promise<boolean> {
  if (!supported) return false;
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Schedules one notification for `plan.sendAt`, replacing any earlier retention notification so at most one is waiting. */
export async function scheduleRetention(plan: Extract<Plan, { send: true }>): Promise<void> {
  if (!supported) return;
  await ensureRetentionChannels();
  await cancelRetentionNotifications();
  await Notifications.scheduleNotificationAsync({
    content: { title: plan.title, body: plan.body, data: { kind: RETENTION_KIND, type: plan.type, url: plan.url } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.sendAt, channelId: channelFor(plan.type) },
  });
}

/** A test notification a few seconds from now. It opens the deck the same way but is not counted anywhere. */
export async function scheduleTest(type: NotifType, title: string, body: string, url: string, inSeconds: number): Promise<void> {
  if (!supported) return;
  await ensureRetentionChannels();
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { kind: RETENTION_TEST_KIND, type, url } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + inSeconds * 1000), channelId: channelFor(type) },
  });
}
