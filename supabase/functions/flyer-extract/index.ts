// POST /functions/v1/flyer-extract  { text, layout?, metro?, origin }  with the person's own sign-in token.
// Receives recognised flyer text (never the image), asks Gemini (free tier) for structured data, validates it and stores or queues the result.
import postgres from 'npm:postgres@3';

import { handleFlyerExtract } from '../_shared/jobs.ts';
import { json, preflight, providerFor, userFrom } from '../_shared/http.ts';
import { PgStore } from '../_shared/supabaseStore.ts';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3 });

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ status: 405, body: { error: 'method' } });
  const user = await userFrom(req, Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  if (!user) return json({ status: 401, body: { error: 'sign_in' } });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ status: 400, body: { error: 'bad_json' } });
  }
  const { model } = await new PgStore(sql).quotaConfig();
  return json(await handleFlyerExtract(user, body, { sql, provider: providerFor(model), now: new Date() }));
});
