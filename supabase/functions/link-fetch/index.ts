// POST /functions/v1/link-fetch  { url }  with the person's sign-in token.
// Fallback for a shared link the phone could not read: fetches that one public page logged out and returns only the
// preview image address and caption text.
import { json, preflight, userFrom } from '../_shared/http.ts';
import { fetchPreview, isSafeUrl } from '../_shared/linkfetch.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ status: 405, body: { error: 'method' } });
  const user = await userFrom(req, Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  if (!user) return json({ status: 401, body: { error: 'sign_in' } });
  let url = '';
  try {
    url = String((await req.json()).url ?? '');
  } catch {
    return json({ status: 400, body: { error: 'bad_json' } });
  }
  if (!isSafeUrl(url)) return json({ status: 400, body: { error: 'bad_url' } });
  const p = await fetchPreview(url);
  return json({ status: 200, body: p ? { ok: true, ...p } : { ok: false } });
});
