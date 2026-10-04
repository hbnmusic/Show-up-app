/** Calls for flyers and first-party shows. Every function returns data or an error message; none throw. */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../communityConfig';
import { parseFpRows, type FpRow } from '../fpMerge';
import { parseSwitches, type LicensedSwitches } from '../licensed';
import { supabase } from '../supabase';

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status?: number };

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Could not reach the server');

export async function fetchFpShows(metro: string): Promise<Result<FpRow[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { data, error } = await supabase.rpc('fp_public_shows', { p_metro: metro });
    if (error) throw error;
    return { ok: true, data: parseFpRows(data) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function fetchSwitches(): Promise<Result<LicensedSwitches>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { data, error } = await supabase.rpc('fp_licensed_switches');
    if (error) throw error;
    return { ok: true, data: parseSwitches(data) };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export type JobShow = { id: string; headliner: string; localDate: string; visibility: 'public' | 'pending' | 'removed'; venueName?: string; startLocal?: string | null };
export type Job = { id: string; status: string; result: string | null; reason: string | null; createdAt: string; finishedAt: string | null; notified: boolean; shows: JobShow[] };

export async function fetchMyJobs(): Promise<Result<Job[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { data, error } = await supabase.rpc('fp_my_flyer_jobs');
    if (error) throw error;
    return { ok: true, data: Array.isArray(data) ? (data as Job[]) : [] };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

export async function markNotified(ids: string[]): Promise<void> {
  if (!supabase || !ids.length) return;
  try {
    await supabase.rpc('fp_mark_notified', { ids });
  } catch {
    // The next poll tries again.
  }
}

export type QueueItem = { id: string; headliner: string; supports: string[]; venueName: string; city?: string; localDate: string; startLocal?: string };

export async function fetchConfirmQueue(metro: string): Promise<Result<QueueItem[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { data, error } = await supabase.rpc('fp_confirm_queue', { p_metro: metro });
    if (error) throw error;
    return { ok: true, data: Array.isArray(data) ? (data as QueueItem[]) : [] };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

async function act(name: string, args: Record<string, unknown>): Promise<Result<null>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { error } = await supabase.rpc(name, args);
    if (error) throw error;
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
export const confirmFpShow = (sid: string) => act('fp_confirm_show', { sid });
export const reportFpShow = (sid: string, why?: string) => act('fp_report_show', { sid, why: why ?? null });
export const withdrawFpShow = (sid: string) => act('fp_withdraw_show', { sid });

export type SubmitReply = { jobId?: string; status?: string; result?: string; reason?: string | null; showIds?: string[]; quotaHit?: boolean };

/** Calls an Edge Function with the person's own sign-in token. The flyer image is never part of any request. */
async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<Result<T>> {
  if (!supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: false, error: 'not configured' };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, error: 'sign_in', code: 'sign_in' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: typeof json.error === 'string' ? json.error : `HTTP ${res.status}`, code: typeof json.error === 'string' ? json.error : undefined, status: res.status };
      return { ok: true, data: json as T };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : msg(e), code: 'network' };
  }
}

export const submitFlyerText = (b: { text: string; layout: string; metro?: string; origin: 'image' | 'link' }) => callFunction<SubmitReply>('flyer-extract', b);
export const linkFetchViaServer = (url: string) => callFunction<{ ok: boolean; imageUrl?: string; caption?: string; title?: string }>('link-fetch', { url });
