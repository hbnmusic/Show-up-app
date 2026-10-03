import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { track } from './analyticsCore';
import { ensureNotificationPermission, syncReminders } from './reminders';
import { useApp } from './store';
import type { Decision } from './types';

/** Record a swipe and keep reminders in step. */
export async function recordDecision(showId: string, d: Decision) {
  useApp.getState().decide(showId, d);
  track('decision', { d });
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(d === 'going' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(
      () => {},
    );
  }
  if (d === 'going' && !useApp.getState().notificationsAsked) {
    // First "going" is when the app explains, then asks for, notification permission. Asked once; Settings can ask again.
    await ensureNotificationPermission().catch(() => false);
  }
  await syncReminders();
}

export async function removeDecision(showId: string) {
  useApp.getState().clearDecision(showId);
  await syncReminders();
}
