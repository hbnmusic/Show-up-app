import * as Location from 'expo-location';

import { useApp } from './store';
import { DEFAULT_METRO, METROS, metroById, nearestMetro, type Metro } from './metros';
import type { Place } from './types';

/** Farther than this from every covered city and the phone is outside the feed. */
const COVERED_WITHIN_MI = 60;

export function cityPlace(m: Metro): Place {
  return { label: m.name, lat: m.lat, lng: m.lng, metro: m.id, source: 'city' };
}

export type Detected =
  | { ok: true; place: Place; /** Nearest covered city, and how far away the phone is from it. */ nearest: Metro; miles: number; covered: boolean }
  | { ok: false; reason: 'denied' | 'unavailable' };

/** One-off position from the phone, turned into a Place. Never stored anywhere but on the phone. */
export async function detectPlace(): Promise<Detected> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 })) ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]));
    if (!pos) return { ok: false, reason: 'unavailable' };
    const { latitude, longitude } = pos.coords;
    const { metro, miles } = nearestMetro(latitude, longitude);
    const covered = miles <= COVERED_WITHIN_MI;
    const place: Place = covered
      ? { label: `Near you (${metro.name} area)`, lat: latitude, lng: longitude, metro: metro.id, source: 'device' }
      : cityPlace(metro);
    return { ok: true, place, nearest: metro, miles, covered };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * First launch: pick the deck's place from the phone's location, falling back
 * to New York. Runs once; after that the person chooses in Filters.
 */
export async function initPlace(): Promise<void> {
  const st = useApp.getState();
  if (st.filters.place) return;
  if (st.placeAsked) {
    st.setFilters({ place: cityPlace(DEFAULT_METRO) });
    return;
  }
  const found = await detectPlace();
  const place = found.ok ? found.place : cityPlace(DEFAULT_METRO);
  useApp.getState().markPlaceAsked();
  // The person may have picked a city while the lookup ran.
  if (!useApp.getState().filters.place) useApp.getState().setFilters({ place });
}

export { METROS, metroById };
