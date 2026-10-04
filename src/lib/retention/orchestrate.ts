/**
 * One background check, from waking up to (maybe) scheduling a notification. Side effects are passed in, so the whole flow is
 * tested with fakes. The real ones are in service.ts.
 */
import { planRetention, recordScheduled, settle, type NotifType, type Plan, type PlanInput, type RetentionState, type SkipReason } from './planner';

export type CheckDeps = {
  now: () => Date;
  /** Reads the notifications_enabled kill switch (after refreshing the cached flags if they are stale). */
  notificationsFlagOn: () => Promise<boolean>;
  /** Everything the planner needs except the clock, the state and the permission; null when no city is selected. */
  gather: () => Promise<Omit<PlanInput, 'now' | 'state' | 'enabled'> & { enabled: Pick<PlanInput['enabled'], 'metro' | 'typeA' | 'typeB'> } | null>;
  /** Downloads the selected city's listings if they are due. */
  refreshFeed: (cityId: string) => Promise<void>;
  /** Re-reads what refreshFeed may have changed (listings and when they were downloaded). */
  gatherAfterRefresh: () => Promise<Awaited<ReturnType<CheckDeps['gather']>>>;
  permissionGranted: () => Promise<boolean>;
  loadState: () => Promise<RetentionState>;
  saveState: (s: RetentionState) => Promise<void>;
  /** Schedules the local notification. */
  schedule: (p: Extract<Plan, { send: true }>) => Promise<void>;
  /** Cancels everything this feature scheduled. */
  cancelAll: () => Promise<void>;
};

export type CheckResult = { outcome: 'scheduled'; type: NotifType; n: number } | { outcome: 'skipped'; reason: SkipReason | 'no_city' };

export async function runRetentionCheck(d: CheckDeps): Promise<CheckResult> {
  if (!(await d.notificationsFlagOn())) {
    await d.cancelAll();
    return { outcome: 'skipped', reason: 'switched_off' };
  }
  const first = await d.gather();
  if (!first) return { outcome: 'skipped', reason: 'no_city' };
  // A city that is switched off, or a phone with both toggles off, needs no download.
  if (first.enabled.metro && (first.enabled.typeA || first.enabled.typeB)) await d.refreshFeed(first.city.id);
  const input = (await d.gatherAfterRefresh()) ?? first;

  const now = d.now();
  const state = settle(await d.loadState(), now.getTime());
  const permission = await d.permissionGranted();
  const plan = planRetention({ ...input, now, state, enabled: { ...input.enabled, flag: true, permission } });
  if (!plan.send) {
    await d.saveState(state);
    // A city or toggle that is off, or a missing permission, leaves nothing scheduled.
    if (plan.reason === 'city_off' || plan.reason === 'both_off' || plan.reason === 'no_permission') await d.cancelAll();
    return { outcome: 'skipped', reason: plan.reason };
  }
  await d.schedule(plan);
  await d.saveState(recordScheduled(state, plan.type, plan.sendAt.getTime()));
  return { outcome: 'scheduled', type: plan.type, n: plan.n };
}
