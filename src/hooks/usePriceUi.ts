import { useMemo } from 'react';

import { useNow } from '@/hooks/useNow';
import { useListings } from '@/lib/listingsStore';
import { showPriceUi } from '@/lib/priceCoverage';
import { useApp } from '@/lib/store';

/** True when enough of the selected city's shows have a known price to make the price filter and "Cost" line useful. */
export function usePriceUi(): boolean {
  const shows = useListings((s) => s.shows);
  const metro = useApp((s) => s.filters.place?.metro);
  const now = useNow();
  return useMemo(() => showPriceUi(shows, metro, now), [shows, metro, now]);
}

/** Same answer outside a component (calendar text). */
export function currentPriceUi(): boolean {
  return showPriceUi(useListings.getState().shows, useApp.getState().filters.place?.metro, new Date());
}
