import { useFlags } from '../flags';
import { isOn } from '../flagsCore';
import { countFor } from './service';
import { useGoing } from './store';

/** The "N going" number to show for a show, or null (show nothing). Hidden while the kill switch is off. */
export function useGoingCount(showId: string | undefined): number | null {
  const on = useFlags((s) => isOn(s.flags, 'going_counts_enabled'));
  const byId = useGoing((s) => s.counts.byId);
  if (!on || !showId) return null;
  return countFor(byId, showId);
}
