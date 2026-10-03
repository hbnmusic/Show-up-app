/**
 * The server-side flow for flyers and venue pages, written against a small `Store` interface so it runs the
 * same against Supabase (Edge Functions) and an in-memory store (tests with recorded model responses).
 */
import { parseModelOutput } from './flyerSchema.ts';
import { cluster, mergeGroup, nightOf, sameShow, type MergedShow } from './match.ts';
import { decidePublish, pendingReason, TRUSTED_AFTER_CONFIRMED, type PublishDecision } from './publish.ts';
import { canSpend, planRetry, quotaDay, type QuotaConfig, type Usage } from './quota.ts';
import { ProviderError, QuotaError, type LlmProvider, type LlmUsage } from './provider.ts';
import { buildFlyerPrompt, buildVenuePrompt, FLYER_SYSTEM, VENUE_SYSTEM } from './prompt.ts';
import { redactText } from './redact.ts';
import { validateFlyer, validateVenuePage } from './validate.ts';
import type { Candidate, MetroRow, VenueRow } from './types.ts';
import { todayIn } from './dates.ts';

export type StoredRecord = { showId: string; candidate: Candidate; submitter: string | null };
export type ShowVisibility = 'public' | 'pending' | 'removed';

export interface Store {
  quotaConfig(): Promise<QuotaConfig & { model: string }>;
  usage(day: string): Promise<Usage>;
  addUsage(day: string, kind: 'flyer' | 'venue', d: { requests?: number; throttled?: number; usage?: LlmUsage }): Promise<void>;
  metros(): Promise<MetroRow[]>;
  registry(): Promise<VenueRow[]>;
  isBanned(uid: string | null): Promise<boolean>;
  isTrusted(uid: string | null): Promise<boolean>;
  isBlockedKey(key: string): Promise<boolean>;
  /** Records for shows in the metro on the given nights (calendar dates), with the show's current visibility. */
  recordsNear(metro: string, nights: string[]): Promise<(StoredRecord & { visibility: ShowVisibility })[]>;
  /** Writes or updates the merged show and appends the new source record. Returns the show id. */
  /** After a full read of a venue's page: shows it still lists are confirmed; future shows it no longer lists become "unconfirmed" (never "cancelled"). */
  markUnconfirmed(venueId: string, seenKeys: string[], today: string): Promise<number>;
  saveShow(m: MergedShow, o: { showId?: string; visibility: ShowVisibility; submitter: string | null; confidence?: number; corroborated: boolean }, record: Candidate): Promise<string>;
}

export type IngestResult = { showId: string; visibility: ShowVisibility; merged: MergedShow; corroborated: boolean } | { skipped: 'removed' | 'blocked' };

const dayBefore = (d: string, n: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
};

/** Matches a candidate to existing first-party records, merges, and stores. Venue-site records publish; flyers follow the rule. */
export async function ingestCandidate(
  store: Store,
  cand: Candidate,
  o: { submitter: string | null; trusted: boolean; metro: string },
): Promise<IngestResult> {
  const night = nightOf(cand.localDate, cand.startLocal);
  const near = await store.recordsNear(o.metro, [dayBefore(night, -1), night, dayBefore(night, 1)]);
  const mine = near.filter((r) => sameShow(r.candidate, cand));
  const showIds = [...new Set(mine.map((r) => r.showId))];
  const existing = near.filter((r) => showIds.includes(r.showId));
  if (existing.some((r) => r.visibility === 'removed')) return { skipped: 'removed' };

  const group = [...existing.map((r) => r.candidate), cand];
  const grouped = cluster(group).find((g) => g.includes(cand)) ?? [cand];
  const merged = mergeGroup(grouped);
  if (await store.isBlockedKey(merged.key)) return { skipped: 'blocked' };

  // Corroboration: the venue's own site, or another person's flyer, agrees with this record.
  const others = existing.filter((r) => r.candidate.sourceType === 'venue_site' || (r.submitter && r.submitter !== o.submitter));
  const corroborated = others.length > 0;
  const wasPublic = existing.some((r) => r.visibility === 'public');
  let visibility: ShowVisibility;
  let decision: PublishDecision;
  if (cand.sourceType === 'venue_site') {
    visibility = 'public';
  } else {
    decision = decidePublish({ confidence: cand.confidence ?? 0, corroborated, trusted: o.trusted });
    visibility = wasPublic || decision === 'publish' ? 'public' : 'pending';
  }
  const submitter = cand.sourceType === 'flyer' ? o.submitter : (existing.find((r) => r.submitter)?.submitter ?? null);
  const showId = await store.saveShow(merged, { showId: showIds[0], visibility, submitter, confidence: cand.confidence, corroborated: corroborated || wasPublic }, cand);
  return { showId, visibility, merged, corroborated };
}

// ---- flyers --------------------------------------------------------------------------------------------------------------

export type FlyerJob = { id: string; ocrText: string; layout?: string | null; metroHint?: string | null; submitter: string | null; anonymous: boolean; attempts: number };
export type JobOutcome = {
  status: 'done' | 'retry' | 'failed';
  result: 'published' | 'pending' | 'processing' | 'rejected';
  reason?: string;
  showIds: string[];
  retryAtMs?: number;
  usage?: LlmUsage;
  quotaHit?: boolean;
};

export async function processFlyerJob(job: FlyerJob, deps: { store: Store; provider: LlmProvider; now: Date }): Promise<JobOutcome> {
  const { store, provider, now } = deps;
  if (await store.isBanned(job.submitter)) return { status: 'done', result: 'rejected', reason: 'banned', showIds: [] };
  const day = quotaDay(now);
  const cfg = await store.quotaConfig();
  const attempt = job.attempts + 1;

  const later = async (reason: string, retryAfter?: number): Promise<JobOutcome> => {
    await store.addUsage(day, 'flyer', { throttled: 1 });
    const plan = planRetry(attempt, now, retryAfter);
    if (plan.next === 'give_up') return { status: 'failed', result: 'rejected', reason: 'quota_gave_up', showIds: [], quotaHit: true };
    return { status: 'retry', result: 'processing', reason, showIds: [], retryAtMs: plan.atMs, quotaHit: true };
  };

  if (!canSpend('flyer', await store.usage(day), cfg)) return later('quota');

  const metros = await store.metros();
  const metro = metros.find((m) => m.id === job.metroHint) ?? null;
  const text = redactText(job.ocrText).slice(0, 8000);
  const prompt = buildFlyerPrompt({ text, layout: job.layout ?? undefined, metro: metro ? { id: metro.id, name: metro.name, state: metro.state, tz: metro.tz } : null, today: metro ? todayIn(metro.tz, now).y + '-' + String(todayIn(metro.tz, now).m).padStart(2, '0') + '-' + String(todayIn(metro.tz, now).d).padStart(2, '0') : now.toISOString().slice(0, 10) });

  let json: unknown;
  let usage: LlmUsage;
  try {
    const r = await provider.extract({ system: FLYER_SYSTEM, prompt });
    json = r.json;
    usage = r.usage;
    await store.addUsage(day, 'flyer', { requests: 1, usage });
  } catch (e) {
    if (e instanceof QuotaError) return later('quota', e.retryAfterSec);
    if (e instanceof ProviderError) return later('provider_error');
    throw e;
  }

  const parsed = parseModelOutput(json, text);
  const registry = await store.registry();
  const v = validateFlyer(parsed, { metros, registry, hintMetro: job.metroHint, now, fetchedAt: now.toISOString() });
  if (v.outcome === 'unsafe') return { status: 'done', result: 'rejected', reason: 'unsafe', showIds: [], usage };
  if (v.outcome === 'not_flyer') return { status: 'done', result: 'rejected', reason: 'not_a_flyer', showIds: [], usage };
  if (v.outcome === 'no_events') return { status: 'done', result: 'rejected', reason: v.rejects[0]?.reason ?? 'no_events', showIds: [], usage };

  const trusted = await store.isTrusted(job.submitter);
  const showIds: string[] = [];
  let published = 0;
  let pending = 0;
  let pendingWhy: string | null = null;
  for (const c of v.candidates) {
    const r = await ingestCandidate(store, c, { submitter: job.submitter, trusted, metro: c.metro! });
    if ('skipped' in r) continue;
    showIds.push(r.showId);
    if (r.visibility === 'public') published++;
    else {
      pending++;
      pendingWhy ??= pendingReason({ confidence: c.confidence ?? 0, corroborated: r.corroborated, trusted }) ?? 'needs_confirmation';
    }
  }
  if (published) return { status: 'done', result: 'published', showIds, usage };
  if (pending) return { status: 'done', result: 'pending', reason: pendingWhy ?? 'needs_confirmation', showIds, usage };
  return { status: 'done', result: 'rejected', reason: 'removed_or_blocked', showIds, usage };
}

// ---- venue pages (model tier) ---------------------------------------------------------------------------------------------

export type VenuePageOutcome =
  | { status: 'ok'; extracted: number; rejected: number; showIds: string[]; usage: LlmUsage }
  | { status: 'quota' | 'error'; retryAtMs?: number };

export async function processVenuePage(
  venue: VenueRow,
  page: { url: string; text: string },
  deps: { store: Store; provider: LlmProvider; now: Date },
): Promise<VenuePageOutcome> {
  const { store, provider, now } = deps;
  const day = quotaDay(now);
  const cfg = await store.quotaConfig();
  if (!canSpend('venue', await store.usage(day), cfg)) {
    await store.addUsage(day, 'venue', { throttled: 1 });
    return { status: 'quota' };
  }
  const metros = await store.metros();
  const metro = metros.find((m) => m.id === venue.metro);
  if (!metro) return { status: 'error' };
  const t = todayIn(metro.tz, now);
  const prompt = buildVenuePrompt({ venue: venue.name, metro: { id: metro.id, name: metro.name, state: metro.state, tz: metro.tz }, today: `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`, text: page.text });
  let json: unknown;
  let usage: LlmUsage;
  try {
    const r = await provider.extract({ system: VENUE_SYSTEM, prompt, maxOutputTokens: 8192 });
    json = r.json;
    usage = r.usage;
    await store.addUsage(day, 'venue', { requests: 1, usage });
  } catch (e) {
    if (e instanceof QuotaError) {
      await store.addUsage(day, 'venue', { throttled: 1 });
      return { status: 'quota', retryAtMs: now.getTime() + (e.retryAfterSec ?? 3600) * 1000 };
    }
    if (e instanceof ProviderError) return { status: 'error' };
    throw e;
  }
  const parsed = parseModelOutput(json, page.text);
  const { candidates, rejects } = validateVenuePage(parsed, venue, metro, now, page.url);
  const showIds: string[] = [];
  for (const c of candidates) {
    const r = await ingestCandidate(store, c, { submitter: null, trusted: true, metro: metro.id });
    if (!('skipped' in r)) showIds.push(r.showId);
  }
  return { status: 'ok', extracted: candidates.length + rejects.length, rejected: rejects.length, showIds, usage };
}

/** Submitters become trusted after enough of their shows were confirmed by other people. */
export const isTrustedByHistory = (confirmedShows: number) => confirmedShows >= TRUSTED_AFTER_CONFIRMED;
