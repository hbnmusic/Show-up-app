/** Request handlers for the Edge Functions, written against `Sql` and `LlmProvider` so they run the same in tests. */
import { evaluateVenue, shouldDisable, type RunHealth, type VenueChecks } from './approval.ts';
import { coverageReport, weeklySummary } from './coverage.ts';
import { todayIn } from './dates.ts';
import { rawToCandidate, type RawEvent, type Tier } from './extract.ts';
import { ingestCandidate, processFlyerJob, processVenuePage, type JobOutcome } from './pipeline.ts';
import type { LlmProvider } from './provider.ts';
import { HIGH_CONFIDENCE } from './publish.ts';
import { quotaDay, submitLimit } from './quota.ts';
import { redactText } from './redact.ts';
import { PgStore, type Row, type Sql } from './supabaseStore.ts';
import type { RobotsStatus, VenueRow } from './types.ts';
import { assignWaves, decideWidening, planScan, type MetroSetting } from './waves.ts';

export type Reply = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, ...extra } });

export type Deps = { sql: Sql; provider: LlmProvider | null; now: Date };

// ---- applying a job outcome to its row ---------------------------------------------------------------------------------

async function applyOutcome(sql: Sql, id: string, attempts: number, o: JobOutcome): Promise<void> {
  const done = o.status === 'done' || o.status === 'failed';
  await sql`
    update fp.flyer_jobs set status = ${o.status}, result = ${o.result}, reason = ${o.reason ?? null}, attempts = ${attempts + 1},
      next_attempt_at = ${o.retryAtMs ? new Date(o.retryAtMs).toISOString() : new Date().toISOString()}::timestamptz,
      show_ids = ${o.showIds}::uuid[], notified = false, finished_at = ${done ? new Date().toISOString() : null}::timestamptz
    where id = ${id}::uuid`;
}

// ---- POST flyer-extract (signed-in or anonymous person) --------------------------------------------------------------

export type FlyerBody = { text?: unknown; layout?: unknown; metro?: unknown; origin?: unknown };

export async function handleFlyerExtract(user: { id: string; anonymous: boolean }, body: FlyerBody, deps: Deps): Promise<Reply> {
  const { sql, provider, now } = deps;
  const store = new PgStore(sql);
  const text = typeof body.text === 'string' ? redactText(body.text).trim() : '';
  const layout = typeof body.layout === 'string' ? redactText(body.layout).slice(0, 4000) : null;
  const origin = body.origin === 'link' ? 'link' : 'image';
  if (text.length < 15 || text.length > 8000) return fail(400, 'bad_text');
  const metros = await store.metros();
  const metro = typeof body.metro === 'string' && metros.some((m) => m.id === body.metro) ? (body.metro as string) : null;

  if (await store.isBanned(user.id)) return fail(403, 'banned');
  if (!(await sql`select public.pu_accepted_terms(${user.id}::uuid) as ok`)[0]?.ok) return fail(403, 'terms');
  const limit = submitLimit(user.anonymous);
  const used = Number((await sql`select count(*) as n from fp.flyer_jobs where submitter = ${user.id}::uuid and created_at > now() - interval '24 hours'`)[0].n);
  if (used >= limit) return fail(429, 'limit', { limit });

  const rows = await sql`
    insert into fp.flyer_jobs (submitter, anonymous, origin, metro_hint, ocr_text, layout, status)
    values (${user.id}::uuid, ${user.anonymous}, ${origin}, ${metro}, ${text}, ${layout}, 'processing') returning id::text as id`;
  const id = rows[0].id as string;

  if (!provider) {
    await sql`update fp.flyer_jobs set status = 'retry', result = 'processing', reason = 'not_configured', next_attempt_at = now() + interval '30 minutes' where id = ${id}::uuid`;
    return ok({ jobId: id, status: 'retry', result: 'processing', reason: 'not_configured' });
  }
  const outcome = await processFlyerJob({ id, ocrText: text, layout, metroHint: metro, submitter: user.id, anonymous: user.anonymous, attempts: 0 }, { store, provider, now });
  await applyOutcome(sql, id, 0, outcome);
  return ok({ jobId: id, status: outcome.status, result: outcome.result, reason: outcome.reason ?? null, showIds: outcome.showIds, quotaHit: outcome.quotaHit ?? false });
}

// ---- job-token actions (cron and the scanner) -------------------------------------------------------------------------

export async function runRetry(deps: Deps): Promise<Reply> {
  const { sql, provider, now } = deps;
  if (!provider) return ok({ processed: 0, note: 'not_configured' });
  const store = new PgStore(sql);
  // A job stuck in "processing" for 10 minutes (function crashed) goes back to the queue.
  await sql`update fp.flyer_jobs set status = 'retry' where status = 'processing' and finished_at is null and claimed_at < now() - interval '10 minutes'`;
  const jobs = await sql`
    update fp.flyer_jobs set status = 'processing', claimed_at = now() where id in (
      select id from fp.flyer_jobs where status in ('queued', 'retry') and next_attempt_at <= now() order by next_attempt_at limit 5 for update skip locked)
    returning id::text as id, submitter::text as submitter, anonymous, metro_hint, ocr_text, layout, attempts, next_attempt_at`;
  jobs.sort((a, b) => new Date(a.next_attempt_at).getTime() - new Date(b.next_attempt_at).getTime());
  const results: { id: string; status: string; result: string }[] = [];
  for (const j of jobs) {
    const outcome = await processFlyerJob(
      { id: j.id, ocrText: j.ocr_text ?? '', layout: j.layout, metroHint: j.metro_hint, submitter: j.submitter, anonymous: j.anonymous, attempts: j.attempts },
      { store, provider, now },
    );
    await applyOutcome(sql, j.id, j.attempts, outcome);
    results.push({ id: j.id, status: outcome.status, result: outcome.result });
    if (outcome.quotaHit) break; // the quota is the problem; stop spending this minute
  }
  // Jobs claimed but not reached go back in the queue untouched.
  const left = jobs.filter((j) => !results.some((r) => r.id === j.id)).map((j) => j.id as string);
  if (left.length) await sql`update fp.flyer_jobs set status = 'retry' where id = any (${left}::uuid[])`;
  return ok({ processed: results.length, results });
}

type Settings = (MetroSetting & { tz: string })[];

async function loadSettings(sql: Sql): Promise<Settings> {
  const rows = await sql`select metro, wave, venue_scan_enabled, daily_request_budget, last_full_scan_at::text as last, tz from fp.metro_config order by metro`;
  return rows.map((r) => ({ id: r.metro, wave: r.wave, venueScanEnabled: r.venue_scan_enabled, dailyRequestBudget: r.daily_request_budget, lastFullScanAt: r.last, tz: r.tz }));
}

async function aiConfigValue(sql: Sql, key: string, fallback: number): Promise<number> {
  const r = await sql`select value from fp.ai_config where key = ${key}`;
  return r.length ? Number(r[0].value) : fallback;
}

/** What the scanner should do now: approved venues due for a read, and candidate venues awaiting a trial. */
export async function planAction(deps: Deps, opts: { candidateLimit?: number } = {}): Promise<Reply> {
  const { sql, now } = deps;
  const settings = await loadSettings(sql);
  const refreshDays = await aiConfigValue(sql, 'refresh_days', 7);
  const rows = await sql`
    select id::text as id, metro, tier, status, last_checked_at::text as last, website, events_url, publish_method, canonical_name, content_hash, etag, last_modified, lat, lng
    from fp.venues where status in ('approved', 'candidate') and not takedown`;
  const approved = rows.filter((r) => r.status === 'approved').map((r) => ({ id: r.id, metro: r.metro, tier: r.tier ?? 'B', lastCheckedAt: r.last, status: r.status, needsAi: r.publish_method === 'ai' }));
  const plan = planScan(approved, settings, now, refreshDays);
  const due = new Set(plan.venues.map((v) => v.id));
  const enabled = new Set(settings.filter((s) => s.venueScanEnabled).map((s) => s.id));
  const pick = (r: Row) => ({ id: r.id, metro: r.metro, name: r.canonical_name, website: r.website, eventsUrl: r.events_url, publishMethod: r.publish_method, tier: r.tier, contentHash: r.content_hash, etag: r.etag, lastModified: r.last_modified, lat: r.lat, lng: r.lng, tz: settings.find((s) => s.id === r.metro)?.tz });
  return ok({
    refreshDays,
    scan: rows.filter((r) => due.has(r.id)).map(pick),
    trial: rows.filter((r) => r.status === 'candidate' && enabled.has(r.metro)).slice(0, opts.candidateLimit ?? 40).map(pick),
    aiPlanned: plan.aiUsed,
    skippedForBudget: plan.skippedForBudget,
  });
}

export type RunInfo = { fetchOk: boolean; tier?: Tier | null; extracted?: number; rejected?: number; note?: string; contentHash?: string | null; etag?: string | null; lastModified?: string | null; robots?: RobotsStatus; fullRead?: boolean };

/** Writes the run, updates the venue's fetch state and disables it if the safety rules say so. Returns the reason if disabled. */
export async function recordRun(sql: Sql, venueId: string, run: RunInfo): Promise<string | null> {
  await sql`insert into fp.venue_runs (venue_id, fetch_ok, tier, extracted, rejected, note) values (${venueId}::uuid, ${run.fetchOk}, ${run.tier ?? null}, ${run.extracted ?? 0}, ${run.rejected ?? 0}, ${(run.note ?? '').slice(0, 200)})`;
  await sql`
    update fp.venues set last_checked_at = now(), updated_at = now(),
      content_hash = coalesce(${run.contentHash ?? null}, content_hash), etag = coalesce(${run.etag ?? null}, etag), last_modified = coalesce(${run.lastModified ?? null}, last_modified),
      robots_status = coalesce(${run.robots ?? null}, robots_status)
    where id = ${venueId}::uuid`;
  const recent = await sql`select fetch_ok, extracted, rejected from fp.venue_runs where venue_id = ${venueId}::uuid order by at desc, id desc limit 5`;
  const v = await sql`select robots_status, takedown from fp.venues where id = ${venueId}::uuid`;
  const reason = shouldDisable({
    recent: recent.map((r): RunHealth => ({ fetchOk: r.fetch_ok, extracted: r.extracted, rejected: r.rejected })),
    robots: v[0].robots_status,
    takedown: v[0].takedown,
  });
  if (reason) await sql`update fp.venues set status = 'disabled', status_reasons = array[${reason}], updated_at = now() where id = ${venueId}::uuid and status <> 'disabled'`;
  return reason;
}

async function loadVenue(sql: Sql, id: string): Promise<VenueRow | null> {
  const store = new PgStore(sql);
  return (await store.registry()).find((v) => v.id === id) ?? null;
}

/** Structured tiers: the scanner sends the events it parsed; every rule is applied here. */
export async function ingestEvents(deps: Deps, b: { venueId: string; tier: Tier; pageUrl: string; events: RawEvent[]; run: RunInfo }): Promise<Reply> {
  const { sql, now } = deps;
  const store = new PgStore(sql);
  const venue = await loadVenue(sql, b.venueId);
  if (!venue) return fail(404, 'venue');
  const metro = (await store.metros()).find((m) => m.id === venue.metro);
  if (!metro) return fail(404, 'metro');
  const seen: string[] = [];
  let rejected = 0;
  const reasons: Record<string, number> = {};
  for (const raw of b.events.slice(0, 500)) {
    const r = rawToCandidate(raw, venue, metro, now, b.tier, b.pageUrl);
    if ('reject' in r) {
      // Past shows are normal on a calendar page; they do not count against the venue.
      if (r.reject !== 'past') rejected++;
      reasons[r.reject] = (reasons[r.reject] ?? 0) + 1;
      continue;
    }
    const res = await ingestCandidate(store, r.candidate, { submitter: null, trusted: true, metro: metro.id });
    if (!('skipped' in res)) seen.push(res.merged.key);
  }
  const t = todayIn(metro.tz, now);
  if (b.run.fullRead !== false && seen.length) await store.markUnconfirmed(venue.id, seen, `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`);
  const disabled = await recordRun(sql, venue.id, { ...b.run, fetchOk: true, tier: b.tier, extracted: seen.length + rejected, rejected });
  return ok({ ingested: seen.length, rejected, reasons, disabled });
}

/** Model tier: the scanner sends stripped page text; the Gemini key stays inside this function. */
export async function extractAi(deps: Deps, b: { venueId: string; url: string; text: string; run: RunInfo }): Promise<Reply> {
  const { sql, provider, now } = deps;
  if (!provider) return ok({ status: 'not_configured' });
  const store = new PgStore(sql);
  const venue = await loadVenue(sql, b.venueId);
  if (!venue) return fail(404, 'venue');
  const out = await processVenuePage(venue, { url: b.url, text: b.text.slice(0, 24000) }, { store, provider, now });
  if (out.status !== 'ok') {
    if (out.status === 'error') await recordRun(sql, venue.id, { ...b.run, fetchOk: true, tier: 'ai', note: 'model_error' });
    return ok({ status: out.status });
  }
  const metros = await store.metros();
  const metro = metros.find((m) => m.id === venue.metro)!;
  const t = todayIn(metro.tz, now);
  const keys = (await sql`select key from fp.shows where id = any (${out.showIds}::uuid[])`).map((r) => r.key as string);
  if (keys.length) await store.markUnconfirmed(venue.id, keys, `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`);
  const disabled = await recordRun(sql, venue.id, { ...b.run, fetchOk: true, tier: 'ai', extracted: out.extracted, rejected: out.rejected, note: out.note ?? b.run.note });
  return ok({ status: 'ok', extracted: out.extracted, rejected: out.rejected, ingested: out.showIds.length, disabled, tokens: out.usage });
}

export async function approveVenue(sql: Sql, venueId: string, checks: VenueChecks, method: string | null, eventsUrl: string | null = null): Promise<Reply> {
  const a = evaluateVenue(checks);
  await sql`
    update fp.venues set status = ${a.decision}, tier = ${a.tier}, status_reasons = ${a.reasons}::text[], publish_method = coalesce(${method}, publish_method), events_url = coalesce(${eventsUrl}, events_url),
      robots_status = ${checks.robots}, updated_at = now() where id = ${venueId}::uuid and status in ('candidate', 'quarantined')`;
  return ok({ ...a });
}

export type SeedVenue = { name: string; aliases?: string[]; metro: string; address?: string; neighborhood?: string; lat?: number; lng?: number; website?: string; eventsUrl?: string; seededFrom: 'own_site' | 'wikidata'; wikidataId?: string };

export async function upsertVenues(sql: Sql, venues: SeedVenue[]): Promise<Reply> {
  let added = 0;
  for (const v of venues.slice(0, 500)) {
    const r = await sql`
      insert into fp.venues (canonical_name, aliases, metro, address, neighborhood, lat, lng, website, events_url, seeded_from, wikidata_id)
      select ${v.name.slice(0, 160)}, ${v.aliases ?? []}::text[], ${v.metro}, ${v.address ?? null}, ${v.neighborhood ?? null}, ${v.lat ?? null}, ${v.lng ?? null}, ${v.website ?? null}, ${v.eventsUrl ?? null}, ${v.seededFrom}, ${v.wikidataId ?? null}
      where exists (select 1 from fp.metro_config where metro = ${v.metro})
        and not exists (select 1 from fp.venues where (wikidata_id is not null and wikidata_id = ${v.wikidataId ?? null}) or (metro = ${v.metro} and lower(canonical_name) = lower(${v.name})))
      returning id`;
    added += r.length;
  }
  return ok({ added, received: venues.length });
}

export async function setWaves(sql: Sql, volumes: Record<string, number>): Promise<Reply> {
  const rows = await sql`select metro, hot from fp.metro_config`;
  const waves = assignWaves(rows.map((r) => ({ id: r.metro, hot: r.hot })), volumes);
  for (const [metro, wave] of Object.entries(waves)) await sql`update fp.metro_config set wave = ${wave}, updated_at = now() where metro = ${metro}`;
  return ok({ waves });
}

/** Daily: decide whether to open the next wave. Every decision is logged, with reasons. */
export async function maintenance(deps: Deps): Promise<Reply> {
  const { sql, now } = deps;
  const settings = await loadSettings(sql);
  const refreshDays = await aiConfigValue(sql, 'refresh_days', 7);
  const headroom = Number((await sql`select value from fp.ai_config where key = 'headroom'`)[0]?.value ?? 0.7);
  const cap = await aiConfigValue(sql, 'daily_cap', 200);
  const currentWave = Math.max(1, Math.min(3, await aiConfigValue(sql, 'current_wave', 1))) as 1 | 2 | 3;
  const usage = await sql`select day::text as day, sum(requests)::int as n from fp.ai_usage where day > ${quotaDay(now)}::date - 8 and day < ${quotaDay(now)}::date group by day order by day desc limit 7`;
  const share = usage.map((u) => u.n / cap);
  const off = new Set((await sql`select metro from fp.metro_config where wave <= ${currentWave} and not venue_scan_enabled`).map((r) => r.metro as string));
  const d = decideWidening({ currentWave, settings, now, refreshDays, dailyUsageShare: share, headroom, offFlags: off });
  await sql`insert into fp.widening_log (decision) values (${JSON.stringify({ at: now.toISOString(), currentWave, ...d, usageShare: share })}::text::jsonb)`;
  if (d.widen && d.nextWave) {
    await sql`update fp.ai_config set value = ${JSON.stringify(d.nextWave)}::text::jsonb, updated_at = now() where key = 'current_wave'`;
    await sql`update fp.metro_config set venue_scan_enabled = true, updated_at = now() where wave = ${d.nextWave}`;
  }
  return ok({ ...d, currentWave });
}

export async function markFullScans(sql: Sql): Promise<void> {
  await sql`
    update fp.metro_config m set last_full_scan_at = now() where venue_scan_enabled and not exists (
      select 1 from fp.venues v where v.metro = m.metro and v.status = 'approved'
        and (v.last_checked_at is null or v.last_checked_at < now() - make_interval(days => 7)))
      and exists (select 1 from fp.venues v where v.metro = m.metro and v.status = 'approved')`;
}

export async function coverage(deps: Deps, o: { weekly?: boolean } = {}): Promise<Reply> {
  const { sql, now } = deps;
  const refreshDays = await aiConfigValue(sql, 'refresh_days', 7);
  const metros = (await sql`select metro from fp.metro_config order by metro`).map((r) => r.metro as string);
  const venues = (await sql`select id::text as id, metro, tier, status, last_checked_at::text as last from fp.venues`).map((v) => ({ id: v.id, metro: v.metro, tier: v.tier, status: v.status, lastCheckedAt: v.last }));
  const shows = (await sql`select metro, (select array_agg(distinct s ->> 'sourceType') from jsonb_array_elements(sources) s) as src from fp.shows where visibility = 'public' and local_date >= current_date`).map((s) => ({ metro: s.metro, sources: (s.src ?? []) as string[] }));
  const cov = coverageReport(metros, venues, shows, now, refreshDays);
  if (!o.weekly) return ok({ coverage: cov });
  const cap = await aiConfigValue(sql, 'daily_cap', 200);
  const usage = (await sql`select sum(requests)::int as n from fp.ai_usage where day > current_date - 8 group by day order by day desc`).map((u) => u.n / cap);
  const dis = (await sql`select v.canonical_name as venue, v.status_reasons[1] as reason from fp.venues v where v.status = 'disabled' and v.updated_at > now() - interval '7 days'`).map((r) => ({ venue: r.venue, reason: r.reason ?? 'unknown' }));
  const rej = (await sql`select reason, count(*)::int as count from (select unnest(status_reasons) as reason from fp.venues where status in ('rejected', 'quarantined')) t group by reason order by count desc limit 5`) as { reason: string; count: number }[];
  const wd = (await sql`select decision from fp.widening_log where at > now() - interval '7 days' order by at desc limit 3`).map((r) => `${(r.decision.reasons as string[])[0]}.`);
  const fl = (await sql`select count(*)::int as received, count(*) filter (where result = 'published')::int as published, count(*) filter (where result = 'pending')::int as pending, count(*) filter (where result = 'rejected')::int as rejected from fp.flyer_jobs where created_at > now() - interval '7 days'`)[0];
  const body = weeklySummary({ coverage: cov, newlyDisabled: dis, topRejections: rej, quotaShare: usage, wideningDecisions: wd, flyers: fl as { received: number; published: number; pending: number; rejected: number } });
  await sql`insert into fp.weekly_summaries (week, body) values (${quotaDay(now)}::date, ${body}) on conflict (week) do update set body = excluded.body`;
  return ok({ summary: body, coverage: cov });
}

/** Public and pending shows for matching against licensed feeds. Only ids and match keys leave; no licensed data comes in. */
export async function exportShows(sql: Sql): Promise<Reply> {
  const rows = await sql`
    select id::text as id, metro, venue_id::text as venue_id, venue_name, local_date::text as d, start_local, headliner, supports, visibility, confidence
    from fp.shows where visibility in ('public', 'pending') and local_date >= current_date`;
  return ok({ shows: rows });
}

export async function licensedLink(sql: Sql, links: { showId: string; source: 'jambase' | 'ticketmaster'; externalId: string }[]): Promise<Reply> {
  let n = 0;
  for (const l of links.slice(0, 1000)) {
    await sql`insert into fp.licensed_links (show_id, source, external_id) values (${l.showId}::uuid, ${l.source}, ${l.externalId.slice(0, 120)}) on conflict (show_id, source) do update set external_id = excluded.external_id`;
    await sql`
      update fp.shows set corroborated = true, updated_at = now(),
        visibility = case when visibility = 'pending' and coalesce(confidence, 0) >= ${HIGH_CONFIDENCE} then 'public' else visibility end
      where id = ${l.showId}::uuid and visibility = 'pending'`;
    n++;
  }
  return ok({ linked: n });
}
