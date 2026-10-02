/** Calls to the community database. Every function returns data or an error message; none throw. */
import { supabase } from '../supabase';
import { rowToShow, type SubmissionRow, type SubmitPayload } from './form';
import type { Show } from '../types';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : 'Could not reach the community server',
});

/** Shows other people have added and a second person confirmed, for one city. */
export async function fetchLiveShows(metro: string): Promise<Result<Show[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('metro', metro)
      .eq('status', 'live')
      .gt('starts_at', since)
      .order('starts_at')
      .limit(500);
    if (error) throw error;
    const shows = ((data ?? []) as SubmissionRow[]).map(rowToShow).filter((s): s is Show => s !== null);
    return { ok: true, data: shows };
  } catch (e) {
    return fail(e);
  }
}

/** Everything the signed-in person submitted. */
export async function fetchMine(userId: string): Promise<Result<SubmissionRow[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('created_by', userId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return { ok: true, data: (data ?? []) as SubmissionRow[] };
  } catch (e) {
    return fail(e);
  }
}

/** Pending shows in one city that someone else added and this person has not confirmed. */
export async function fetchQueue(userId: string, metro: string): Promise<Result<SubmissionRow[]>> {
  if (!supabase) return { ok: false, error: 'not configured' };
  try {
    const [rows, conf, reps] = await Promise.all([
      supabase
        .from('submissions')
        .select('*')
        .eq('metro', metro)
        .eq('status', 'pending')
        .neq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('confirmations').select('submission_id').eq('user_id', userId),
      supabase.from('reports').select('submission_id').eq('user_id', userId),
    ]);
    if (rows.error) throw rows.error;
    const done = new Set([...(conf.data ?? []), ...(reps.data ?? [])].map((r) => r.submission_id as string));
    return { ok: true, data: ((rows.data ?? []) as SubmissionRow[]).filter((r) => !done.has(r.id)) };
  } catch (e) {
    return fail(e);
  }
}

async function rpc(name: string, args: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
  if (!supabase) return { ok: false, error: 'Community features are not set up in this build.' };
  try {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return { ok: true, data: (data ?? {}) as Record<string, unknown> };
  } catch (e) {
    return fail(e);
  }
}

/** result 'created' (status says live or pending) or 'confirmed' when the same show was already waiting. */
export const submitShow = (p: SubmitPayload) => rpc('submit_show', { p });
export const confirmSubmission = (sid: string) => rpc('confirm_submission', { sid });
export const reportSubmission = (sid: string, why?: string) => rpc('report_submission', { sid, why: why ?? null });
export const withdrawSubmission = (sid: string) => rpc('withdraw_submission', { sid });
