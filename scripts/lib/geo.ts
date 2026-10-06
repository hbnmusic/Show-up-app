/** Is a venue's address inside its metro? US addresses go through the US Census geocoder (free). Canadian addresses are checked by text. */
import { METROS } from '../../src/lib/metros';
import { norm } from '../../supabase/functions/_shared/text';
import type { FetchFn } from './polite';
import type { PlanVenue } from './scan';

const CANADA = new Set(['ON', 'QC', 'BC', 'AB', 'MB', 'NS', 'NB', 'NL', 'PE', 'SK']);
const MAX_MILES = 45;

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const POSTAL_PROVINCE: Record<string, string> = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC' };

/**
 * Canada: by text. The postal code's first letter fixes the province (M is Ontario, H is Quebec, V is British Columbia);
 * a postal code from another province puts the address outside. Inside needs the metro's city (or an alias) in the
 * text plus a matching province code or postal prefix. Anything else is "unknown".
 */
export function canadianCheck(address: string, metroName: string, province: string, aliases: string[] = []): 'inside' | 'outside' | 'unknown' {
  const t = ` ${norm(address)} `;
  const city = [metroName, ...aliases].flatMap((n) => n.split(/[–\-/]/)).map((n) => norm(n)).filter((n) => n.length >= 3);
  const hasCity = city.some((c) => t.includes(` ${c} `));
  const postal = /\b([a-z])\d[a-z]\s?\d[a-z]\d\b/i.exec(address);
  const postalProv = postal ? POSTAL_PROVINCE[postal[1].toUpperCase()] : undefined;
  if (postalProv && postalProv !== province) return 'outside';
  const hasProv = new RegExp(`\\b${province.toLowerCase()}\\b`).test(address.toLowerCase());
  if (hasCity && (hasProv || postalProv === province)) return 'inside';
  return 'unknown';
}

export function makeGeocoder(doFetch: FetchFn = fetch as unknown as FetchFn, aliasesFor: (metro: string) => string[] = () => []) {
  return async (v: PlanVenue): Promise<boolean | null> => {
    const m = METROS.find((x) => x.id === v.metro);
    if (!m || !v.address) return null;
    if (CANADA.has(m.state)) {
      const c = canadianCheck(v.address, m.name, m.state, aliasesFor(m.id));
      return c === 'inside' ? true : c === 'outside' ? false : null;
    }
    try {
      const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(v.address)}&benchmark=Public_AR_Current&format=json`;
      const res = await doFetch(url, { headers: { 'user-agent': 'ComeThruBot/1.0' }, redirect: 'follow' });
      if (res.status !== 200) return null;
      const j = JSON.parse(await res.text()) as { result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] } };
      const c = j.result?.addressMatches?.[0]?.coordinates;
      if (!c) return null;
      return milesBetween({ lat: c.y, lng: c.x }, m) <= MAX_MILES;
    } catch {
      return null;
    }
  };
}

/**
 * Inside-metro check that prefers coordinates already on the venue (from Wikidata, a source independent of the venue's own site)
 * and falls back to the street-address geocoder only when there are none.
 */
export function withCoordinates(
  fallback: (v: { id: string; metro: string; address?: string | null; name: string }) => Promise<boolean | null>,
  metroOf: (id: string) => { lat: number; lng: number; radiusMi: number } | undefined,
) {
  return async (v: { id: string; metro: string; address?: string | null; name: string; lat?: number | null; lng?: number | null }): Promise<boolean | null> => {
    const m = metroOf(v.metro);
    if (m && typeof v.lat === 'number' && typeof v.lng === 'number') return milesBetween({ lat: v.lat, lng: v.lng }, m) <= m.radiusMi;
    return fallback(v);
  };
}
