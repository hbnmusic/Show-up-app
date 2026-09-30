import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { ensureNotificationPermission, syncReminders } from './reminders';
import { useApp } from './store';
import type { Decision } from './types';

/** Record a swipe and keep reminders in step. */
export async function recordDecision(showId: string, d: Decision) {
  useApp.getState().decide(showId, d);
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(d === 'going' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(
      () => {},
    );
  }
  if (d === 'going') {
    // First "going" is when the app asks for notification permission.
    await ensureNotificationPermission().catch(() => false);
  }
  await syncReminders();
}

export async function removeDecision(showId: string) {
  useApp.getState().clearDecision(showId);
  await syncReminders();
}
