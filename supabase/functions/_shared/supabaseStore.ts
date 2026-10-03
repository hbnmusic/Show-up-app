/**
 * Store backed by Postgres, used inside Edge Functions with the project's own database connection (so the `fp`
 * schema never has to be exposed through the API). `Sql` is the tagged-template shape of the `postgres` library;
 * JSON values are passed as strings and cast in SQL so any driver with that shape works (the tests use PGlite).
 */
import type { MergedShow } from './match.ts';
import type { ShowVisibility, Store, StoredRecord } from './pipeline.ts';
import type { LlmUsage } from './provider.ts';
import { DEFAULT_QUOTA, type QuotaConfig, type Usage } from './quota.ts';
import { TRUSTED_AFTER_CONFIRMED } from './publish.ts';
import type { Candidate, MetroRow, VenueRow } from './types.ts';

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>;

const cut = (s: string | undefined | null, n: number) => (s == null ? null : s.slice(0, n));

export class PgStore implements Store {
  constructor(private sql: Sql) {}

  async quotaConfig(): Promise<QuotaConfig & { model: string }> {
    const rows = await this.sql`select key, value from fp.ai_config`;
    const c: Row = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      dailyCap: Number(c.daily_cap ?? DEFAULT_QUOTA.dailyCap),
      flyerReserveShare: Number(c.flyer_reserve_share ?? DEFAULT_QUOTA.flyerReserveShare),
      model: String(c.model ?? 'gemini-3.5-flash-lite'),
    };
  }

  async usage(day: string): Promise<Usage> {
    const rows = await this.sql`select kind, requests from fp.ai_usage where day = ${day}::date`;
    const get = (k: string) => Number(rows.find((r) => r.kind === k)?.requests ?? 0);
    return { flyer: get('flyer'), venue: get('venue') };
  }

  async addUsage(day: string, kind: 'flyer' | 'venue', d: { requests?: number; throttled?: number; usage?: LlmUsage }): Promise<void> {
    await this.sql`
      insert into fp.ai_usage (day, kind, requests, input_tokens, output_tokens, throttled)
      values (${day}::date, ${kind}, ${d.requests ?? 0}, ${d.usage?.inputTokens ?? 0}, ${d.usage?.outputTokens ?? 0}, ${d.throttled ?? 0})
      on conflict (day, kind) do update set
        requests = fp.ai_usage.requests + excluded.requests,
        input_tokens = fp.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = fp.ai_usage.output_tokens + excluded.output_tokens,
        throttled = fp.ai_usage.throttled + excluded.throttled`;
  }

  async metros(): Promise<MetroRow[]> {
    const rows = await this.sql`select metro as id, name, state, tz, aliases from fp.metro_config order by metro`;
    return rows.map((r) => ({ id: r.id, name: r.name, state: r.state, tz: r.tz, aliases: r.aliases ?? [] }));
  }

  async registry(): Promise<VenueRow[]> {
    const rows = await this.sql`
      select id::text as id, canonical_name, aliases, metro, address, neighborhood, lat, lng, website, events_url, publish_method, robots_status, tier, status
      from fp.venues where status <> 'rejected' and not takedown`;
    return rows.map((r) => ({
      id: r.id, name: r.canonical_name, aliases: r.aliases ?? [], metro: r.metro, address: r.address ?? undefined, neighborhood: r.neighborhood ?? undefined,
      lat: r.lat ?? undefined, lng: r.lng ?? undefined, website: r.website ?? undefined, eventsUrl: r.events_url ?? undefined,
      publishMethod: r.publish_method ?? undefined, robots: r.robots_status, tier: r.tier ?? undefined, status: r.status,
    }));
  }

  async isBanned(uid: string | null): Promise<boolean> {
    if (!uid) return false;
    return (await this.sql`select 1 from public.banned_users where user_id = ${uid}::uuid`).length > 0;
  }

  async isTrusted(uid: string | null): Promise<boolean> {
    if (!uid) return false;
    if ((await this.sql`select 1 from public.trusted_users where user_id = ${uid}::uuid`).length > 0) return true;
    const r = await this.sql`
      select count(*) filter (where visibility = 'public' and confirm_count > 0) as confirmed,
             count(*) filter (where removed_reason in ('reports', 'takedown', 'banned')) as bad
      from fp.shows where submitter = ${uid}::uuid`;
    return Number(r[0]?.confirmed ?? 0) >= TRUSTED_AFTER_CONFIRMED && Number(r[0]?.bad ?? 0) === 0;
  }

  async isBlockedKey(key: string): Promise<boolean> {
    return (await this.sql`select 1 from fp.blocked_keys where key = ${key}`).length > 0;
  }

  async recordsNear(metro: string, nights: string[]): Promise<(StoredRecord & { visibility: ShowVisibility })[]> {
    const rows = await this.sql`
      select r.show_id::text as show_id, r.payload, r.submitter::text as submitter, s.visibility
      from fp.source_records r join fp.shows s on s.id = r.show_id
      where r.metro = ${metro} and r.local_date = any (${nights}::date[])`;
    return rows.map((r) => ({ showId: r.show_id, candidate: r.payload as Candidate, submitter: r.submitter, visibility: r.visibility }));
  }

  async markUnconfirmed(venueId: string, seenKeys: string[], today: string): Promise<number> {
    await this.sql`
      update fp.shows set unconfirmed = not (key = any (${seenKeys}::text[])), updated_at = now()
      where venue_id = ${venueId}::uuid and local_date >= ${today}::date and visibility <> 'removed'
        and sources @> '[{"sourceType":"venue_site"}]'::jsonb`;
    const r = await this.sql`select count(*) as n from fp.shows where venue_id = ${venueId}::uuid and local_date >= ${today}::date and unconfirmed and visibility <> 'removed'`;
    return Number(r[0].n);
  }

  async saveShow(m: MergedShow, o: { showId?: string; visibility: ShowVisibility; submitter: string | null; confidence?: number; corroborated: boolean }, record: Candidate): Promise<string> {
    const image = m.imageUrl && (await this.sql`select 1 from fp.blocked_urls where url = ${m.imageUrl}`).length === 0 ? m.imageUrl : null;
    const vals = {
      supports: JSON.stringify(m.supports.slice(0, 12)),
      price: m.price ? JSON.stringify(m.price) : null,
      field_source: JSON.stringify(m.fieldSource),
      conflicts: JSON.stringify(m.conflicts),
      sources: JSON.stringify(m.sources),
    };
    const ticket = m.ticketUrl && m.ticketUrl.length <= 500 && /^https?:\/\//i.test(m.ticketUrl) ? m.ticketUrl : null;
    const addr = m.addressMode === 'registry' ? cut(m.address, 200) : null;
    let id = o.showId;
    if (id) {
      await this.sql`
        update fp.shows set key = ${m.key}, venue_id = ${m.venueId}::uuid, venue_name = ${cut(m.venueName, 160)}, city = ${cut(m.city, 80)},
          address = ${addr}, address_mode = ${m.addressMode}, local_date = ${m.localDate}::date, start_local = ${m.startLocal ?? null}, doors_local = ${m.doorsLocal ?? null},
          headliner = ${cut(m.headliner, 160)}, supports = ${vals.supports}::jsonb, price = ${vals.price}::jsonb, ticket_url = ${ticket}, status = ${m.status},
          genres = ${m.genres.slice(0, 3)}::text[], age_policy = ${cut(m.agePolicy, 40)}, image_url = ${image}, field_source = ${vals.field_source}::jsonb,
          conflicts = ${vals.conflicts}::jsonb, sources = ${vals.sources}::jsonb, visibility = ${o.visibility}, unconfirmed = false,
          submitter = coalesce(submitter, ${o.submitter}::uuid), confidence = greatest(coalesce(confidence, 0), ${o.confidence ?? 0}),
          corroborated = ${o.corroborated}, updated_at = now()
        where id = ${id}::uuid`;
    } else {
      const r = await this.sql`
        insert into fp.shows (key, metro, venue_id, venue_name, city, address, address_mode, local_date, start_local, doors_local, headliner, supports, price,
          ticket_url, status, genres, age_policy, image_url, field_source, conflicts, sources, visibility, submitter, confidence, corroborated)
        values (${m.key}, ${m.metro}, ${m.venueId}::uuid, ${cut(m.venueName, 160)}, ${cut(m.city, 80)}, ${addr}, ${m.addressMode}, ${m.localDate}::date, ${m.startLocal ?? null}, ${m.doorsLocal ?? null},
          ${cut(m.headliner, 160)}, ${vals.supports}::jsonb, ${vals.price}::jsonb, ${ticket}, ${m.status}, ${m.genres.slice(0, 3)}::text[], ${cut(m.agePolicy, 40)}, ${image},
          ${vals.field_source}::jsonb, ${vals.conflicts}::jsonb, ${vals.sources}::jsonb, ${o.visibility}, ${o.submitter}::uuid, ${o.confidence ?? null}, ${o.corroborated})
        returning id::text as id`;
      id = r[0].id as string;
    }
    await this.sql`
      insert into fp.source_records (show_id, source_type, source_url, fetched_at, venue_id, metro, local_date, submitter, payload)
      values (${id}::uuid, ${record.sourceType}, ${cut(record.sourceUrl, 500)}, ${record.fetchedAt}::timestamptz, ${record.venueId}::uuid, ${record.metro}, ${record.localDate}::date,
        ${record.sourceType === 'flyer' ? o.submitter : null}::uuid, ${JSON.stringify(record)}::jsonb)`;
    return id!;
  }
}
