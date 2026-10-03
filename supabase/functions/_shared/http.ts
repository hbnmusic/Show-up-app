/** Small HTTP helpers shared by the Edge Functions. */
import { GeminiProvider, type LlmProvider } from './provider.ts';
import type { Reply } from './jobs.ts';

export const json = (r: Reply): Response =>
  new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info' } });

export const preflight = (req: Request): Response | null =>
  req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'POST, OPTIONS' } }) : null;

/** Constant-time comparison for the job token. */
export function tokenOk(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The signed-in (or anonymous) person behind a request, checked with Supabase Auth. */
export async function userFrom(req: Request, supabaseUrl: string, anonKey: string): Promise<{ id: string; anonymous: boolean } | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const r = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { authorization: auth, apikey: anonKey } });
  if (!r.ok) return null;
  const u = (await r.json()) as { id?: string; is_anonymous?: boolean };
  return u.id ? { id: u.id, anonymous: u.is_anonymous === true } : null;
}

/** Gemini provider from the function secret, with the model from fp.ai_config. Null when no key is set. */
export function providerFor(model: string): LlmProvider | null {
  const key = Deno.env.get('GEMINI_API_KEY');
  return key ? new GeminiProvider(key, model) : null;
}
