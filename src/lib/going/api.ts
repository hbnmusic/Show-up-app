/** The three calls the app may make about Going counts. Each returns null or false on any failure; none throws. */
import { supabase } from '../supabase';

type Change = { show_id: string; going: boolean; date: string };

export async function setGoing(goingId: string, changes: Change[]): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('set_going', { p_going_id: goingId, p_changes: changes });
    return !error;
  } catch {
    return false;
  }
}

export async function forgetMyGoing(goingId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('forget_my_going', { p_going_id: goingId });
    return !error;
  } catch {
    return false;
  }
}

export async function getGoingCounts(ids: string[]): Promise<unknown | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_going_counts', { p_show_ids: ids });
    return error ? null : data;
  } catch {
    return null;
  }
}
