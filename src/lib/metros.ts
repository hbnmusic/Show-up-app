/**
 * Cities the listings feed covers. The refresh job fetches one search circle
 * per metro, so the app can only offer places inside these circles.
 */
export type MetroId = 'nyc' | 'la' | 'chi';

export type Metro = {
  id: MetroId;
  name: string;
  lat: number;
  lng: number;
  /** IANA zone used for "today" when asking the API for a date range. */
  tz: string;
  /** Search circle the feed fetches around the center, in miles. */
  radiusMi: number;
};

export const METROS: readonly Metro[] = [
  { id: 'nyc', name: 'New York', lat: 40.7128, lng: -74.006, tz: 'America/New_York', radiusMi: 25 },
  { id: 'la', name: 'Los Angeles', lat: 34.0522, lng: -118.2437, tz: 'America/Los_Angeles', radiusMi: 25 },
  { id: 'chi', name: 'Chicago', lat: 41.8781, lng: -87.6298, tz: 'America/Chicago', radiusMi: 25 },
];

export const DEFAULT_METRO: Metro = METROS[0];

export function metroById(id: string | undefined): Metro | undefined {
  return METROS.find((m) => m.id === id);
}

/** Great-circle distance in miles. */
export function distanceMi(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestMetro(lat: number, lng: number): { metro: Metro; miles: number } {
  let best = { metro: METROS[0], miles: Infinity };
  for (const m of METROS) {
    const miles = distanceMi(lat, lng, m.lat, m.lng);
    if (miles < best.miles) best = { metro: m, miles };
  }
  return best;
}
