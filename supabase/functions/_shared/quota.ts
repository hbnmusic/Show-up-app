/** Daily request budget for the free model tier, with part of it kept for flyers, and retry timing. */

export type QuotaConfig = {
  /** Requests per day we allow ourselves. Set from the limit AI Studio shows for the model; the free tier's real limit is not published. */
  dailyCap: number;
  /** Share of the cap held back for flyers so venue scans cannot use it up. */
  flyerReserveShare: number;
};

export const DEFAULT_QUOTA: QuotaConfig = { dailyCap: 200, flyerReserveShare: 0.3 };

export type Usage = { flyer: number; venue: number };
export type Kind = 'flyer' | 'venue';

export function canSpend(kind: Kind, used: Usage, cfg: QuotaConfig = DEFAULT_QUOTA): boolean {
  const total = used.flyer + used.venue;
  if (total >= cfg.dailyCap) return false;
  if (kind === 'flyer') return true;
  const reserve = Math.floor(cfg.dailyCap * cfg.flyerReserveShare);
  const unusedReserve = Math.max(0, reserve - used.flyer);
  return total < cfg.dailyCap - unusedReserve;
}

/** The quota day starts at midnight Pacific time. */
export function quotaDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const MAX_ATTEMPTS = 8;

/** Seconds to wait before retry number `attempt` (1 = first retry): 30s, 60s, 2m ... capped at one hour; a server hint wins if longer. */
export function backoffSeconds(attempt: number, retryAfterSec?: number): number {
  const base = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return Math.max(base, Math.min(3600, retryAfterSec ?? 0));
}

export type RetryPlan = { next: 'retry'; atMs: number } | { next: 'give_up' };

export function planRetry(attempt: number, now: Date, retryAfterSec?: number): RetryPlan {
  if (attempt >= MAX_ATTEMPTS) return { next: 'give_up' };
  return { next: 'retry', atMs: now.getTime() + backoffSeconds(attempt, retryAfterSec) * 1000 };
}

/** Flyers per person per day. Anonymous installs get a lower limit than signed-in people. */
export const SUBMIT_LIMITS = { anonymous: 3, signedIn: 10 } as const;
export const submitLimit = (anonymous: boolean) => (anonymous ? SUBMIT_LIMITS.anonymous : SUBMIT_LIMITS.signedIn);
