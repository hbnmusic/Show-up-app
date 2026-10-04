// POST /functions/v1/fp-job  { action, ... }  with header  x-job-token: <JOB_TOKEN secret>.
// Called by the scheduled GitHub workflow (venue scanning) and by pg_cron (flyer retries). Not for the app.
import postgres from 'npm:postgres@3';

import { approveVenue, coverage, exportShows, extractAi, ingestEvents, licensedLink, maintenance, markFullScans, planAction, recordRun, runRetry, setWaves, upsertVenues } from '../_shared/jobs.ts';
import { json, providerFor, tokenOk } from '../_shared/http.ts';
import { PgStore } from '../_shared/supabaseStore.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ status: 405, body: { error: 'method' } });
  if (!tokenOk(req.headers.get('x-job-token'), Deno.env.get('JOB_TOKEN'))) return json({ status: 401, body: { error: 'token' } });
  // deno-lint-ignore no-explicit-any
  let b: any;
  try {
    b = await req.json();
  } catch {
    return json({ status: 400, body: { error: 'bad_json' } });
  }
  const now = new Date();
  const { model } = await new PgStore(sql).quotaConfig();
  const deps = { sql, provider: providerFor(model), now };
  switch (b.action) {
    case 'retry': return json(await runRetry(deps));
    case 'plan': return json(await planAction(deps));
    case 'ingest_events': return json(await ingestEvents(deps, b));
    case 'extract_ai': return json(await extractAi(deps, b));
    case 'record_run': {
      const disabled = await recordRun(sql, b.venueId, b.run);
      return json({ status: 200, body: { disabled } });
    }
    case 'approve': return json(await approveVenue(sql, b.venueId, b.checks, b.method ?? null, typeof b.eventsUrl === 'string' ? b.eventsUrl : null));
    case 'upsert_venues': return json(await upsertVenues(sql, b.venues ?? []));
    case 'set_waves': return json(await setWaves(sql, b.volumes ?? {}));
    case 'maintenance': {
      await markFullScans(sql);
      return json(await maintenance(deps));
    }
    case 'coverage': return json(await coverage(deps, { weekly: b.weekly === true }));
    case 'export_shows': return json(await exportShows(sql));
    case 'licensed_link': return json(await licensedLink(sql, b.links ?? []));
    case 'purge_old': {
      await sql`select fp.purge_old()`;
      return json({ status: 200, body: { ok: true } });
    }
    default: return json({ status: 400, body: { error: 'action' } });
  }
});
