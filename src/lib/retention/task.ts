/**
 * The background task. Android runs it through WorkManager, at the system's discretion and never more often than every 15
 * minutes, so this is best effort: the phone may run it late, rarely, or (with aggressive battery saving) not at all.
 * `defineTask` has to run when the app's JavaScript starts, so the app's entry file imports this module (see index.ts).
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const RETENTION_TASK = 'pull-up-retention-check';
/** Minutes. The system treats this as a minimum, not a schedule. */
export const TASK_INTERVAL_MIN = 120;

TaskManager.defineTask(RETENTION_TASK, async () => {
  try {
    // Loaded here so importing this file at start-up stays cheap.
    const { backgroundCheck } = await import('./service');
    await backgroundCheck();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerRetentionTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(RETENTION_TASK)) return;
  await BackgroundTask.registerTaskAsync(RETENTION_TASK, { minimumInterval: TASK_INTERVAL_MIN });
}

export async function unregisterRetentionTask(): Promise<void> {
  if (Platform.OS === 'web') return;
  if (await TaskManager.isTaskRegisteredAsync(RETENTION_TASK)) await BackgroundTask.unregisterTaskAsync(RETENTION_TASK);
}
