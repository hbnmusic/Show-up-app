/**
 * Remote kill switches. One source of truth for the app, the Edge Functions and the scheduled jobs: the flag names, the
 * defaults (all ON), how a server reply is read, and when a cached copy is stale. Nothing here holds a secret.
 */
export const FLAG_KEYS = ['jambase_enabled', 'deezer_enabled', 'ai_extraction_enabled', 'flyer_intake_enabled', 'venue_scan_enabled', 'notifications_enabled'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];
export type FlagState = { enabled: boolean; message: string | null };
export type Flags = Record<FlagKey, FlagState>;

export const DEFAULT_FLAGS: Flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, { enabled: true, message: null }])) as Flags;

/** The app reads flags at launch and when it returns to the front, at most this often. */
export const FLAG_REFRESH_MS = 15 * 60 * 1000;

const isKey = (k: unknown): k is FlagKey => typeof k === 'string' && (FLAG_KEYS as readonly string[]).includes(k);

/** Reads get_flags(): an array of {key, enabled, message} (or a {key: boolean} object). Unknown keys are ignored; anything missing or malformed stays ON. */
export function parseFlags(raw: unknown): Flags {
  const out: Flags = Object.fromEntries(FLAG_KEYS.map((k) => [k, { ...DEFAULT_FLAGS[k] }])) as Flags;
  const rows: { key?: unknown; enabled?: unknown; message?: unknown }[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>).map(([key, v]) => (typeof v === 'object' && v ? { key, ...(v as object) } : { key, enabled: v }))
      : [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !isKey(r.key)) continue;
    if (r.enabled === false) out[r.key] = { enabled: false, message: typeof r.message === 'string' && r.message.trim() ? r.message.trim().slice(0, 200) : null };
  }
  return out;
}

export const isOn = (flags: Flags, key: FlagKey): boolean => flags[key]?.enabled !== false;

/** True when a cached copy fetched at `fetchedAt` (ms) should be replaced. Never fetched means stale. */
export function flagsStale(fetchedAt: number | null | undefined, nowMs: number, ttlMs = FLAG_REFRESH_MS): boolean {
  if (fetchedAt == null || !Number.isFinite(fetchedAt)) return true;
  return nowMs - fetchedAt >= ttlMs || nowMs < fetchedAt;
}

/** Reads the flags over HTTP with the project's public (anon) key, as the scheduled jobs do. Returns null if they could not be read. */
export async function fetchFlagsHttp(supabaseUrl: string | undefined, anonKey: string | undefined, doFetch: typeof fetch = fetch): Promise<Flags | null> {
  if (!supabaseUrl || !anonKey) return null;
  try {
    const res = await doFetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/get_flags`, { method: 'POST', headers: { apikey: anonKey, 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) return null;
    return parseFlags(await res.json());
  } catch {
    return null;
  }
}

/** Reads the flags inside an Edge Function, with its own database connection. A read failure leaves everything ON. */
export async function readFlags(sql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<Record<string, unknown>[]>): Promise<Flags> {
  try {
    return parseFlags(await sql`select key, enabled, message from public.app_flags`);
  } catch {
    return parseFlags(null);
  }
}
