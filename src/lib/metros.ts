/**
 * Cities the listings feed covers. The refresh job fetches one search circle
 * per metro and publishes one file per metro, so the app only downloads the
 * city it is looking at.
 */
export type MetroId = string;

export type Metro = {
  id: MetroId;
  name: string;
  /** State or province code, shown beside the name. */
  state: string;
  lat: number;
  lng: number;
  /** IANA zone used for "today" when asking the API for a date range. */
  tz: string;
  /** Search circle the feed fetches around the center, in miles. */
  radiusMi: number;
  /** Large market: refreshed daily. The rest are refreshed every few days to stay inside the API plan. */
  hot: boolean;
  /** Soft-launch city: venue scanning and auto-approval trials prioritise it (see fp.metro_config.soft_launch). */
  softLaunch: boolean;
  /** Retention notifications ("new shows", "shows tonight") may be sent for this city. Off until the owner turns a city on. */
  notificationsEnabled: boolean;
};

/** Cities the soft launch focuses on. Also the only cities with notifications on for now. */
export const SOFT_LAUNCH_METROS: readonly string[] = ['nyc', 'la'];

const m = (id: string, name: string, state: string, lat: number, lng: number, tz: string, hot: boolean): Metro => ({
  id, name, state, lat, lng, tz, radiusMi: 25, hot,
  softLaunch: SOFT_LAUNCH_METROS.includes(id),
  notificationsEnabled: SOFT_LAUNCH_METROS.includes(id),
});

export const METROS: readonly Metro[] = [
  m('nyc', 'New York', 'NY', 40.7128, -74.006, 'America/New_York', true),
  m('la', 'Los Angeles', 'CA', 34.0522, -118.2437, 'America/Los_Angeles', true),
  m('chi', 'Chicago', 'IL', 41.8781, -87.6298, 'America/Chicago', true),
  m('sf', 'San Francisco Bay Area', 'CA', 37.7749, -122.4194, 'America/Los_Angeles', true),
  m('tor', 'Toronto', 'ON', 43.6532, -79.3832, 'America/Toronto', true),
  m('mtl', 'Montréal', 'QC', 45.5017, -73.5673, 'America/Toronto', true),
  m('van', 'Vancouver', 'BC', 49.2827, -123.1207, 'America/Vancouver', true),
  m('bos', 'Boston', 'MA', 42.3601, -71.0589, 'America/New_York', true),
  m('dc', 'Washington', 'DC', 38.9072, -77.0369, 'America/New_York', true),
  m('phl', 'Philadelphia', 'PA', 39.9526, -75.1652, 'America/New_York', true),
  m('atl', 'Atlanta', 'GA', 33.749, -84.388, 'America/New_York', false),
  m('mia', 'Miami', 'FL', 25.7617, -80.1918, 'America/New_York', false),
  m('sea', 'Seattle', 'WA', 47.6062, -122.3321, 'America/Los_Angeles', false),
  m('aus', 'Austin', 'TX', 30.2672, -97.7431, 'America/Chicago', false),
  m('nash', 'Nashville', 'TN', 36.1627, -86.7816, 'America/Chicago', false),
  m('den', 'Denver', 'CO', 39.7392, -104.9903, 'America/Denver', false),
  m('dal', 'Dallas–Fort Worth', 'TX', 32.7767, -96.797, 'America/Chicago', false),
  m('hou', 'Houston', 'TX', 29.7604, -95.3698, 'America/Chicago', false),
  m('phx', 'Phoenix', 'AZ', 33.4484, -112.074, 'America/Phoenix', false),
  m('sd', 'San Diego', 'CA', 32.7157, -117.1611, 'America/Los_Angeles', false),
  m('por', 'Portland', 'OR', 45.5152, -122.6784, 'America/Los_Angeles', false),
  m('lv', 'Las Vegas', 'NV', 36.1699, -115.1398, 'America/Los_Angeles', false),
  m('msp', 'Minneapolis–St. Paul', 'MN', 44.9778, -93.265, 'America/Chicago', false),
  m('det', 'Detroit', 'MI', 42.3314, -83.0458, 'America/Detroit', false),
  m('nola', 'New Orleans', 'LA', 29.9511, -90.0715, 'America/Chicago', false),
  m('pit', 'Pittsburgh', 'PA', 40.4406, -79.9959, 'America/New_York', false),
  m('bal', 'Baltimore', 'MD', 39.2904, -76.6122, 'America/New_York', false),
  m('stl', 'St. Louis', 'MO', 38.627, -90.1994, 'America/Chicago', false),
  m('kc', 'Kansas City', 'MO', 39.0997, -94.5786, 'America/Chicago', false),
  m('orl', 'Orlando', 'FL', 28.5383, -81.3792, 'America/New_York', false),
  m('tpa', 'Tampa', 'FL', 27.9506, -82.4572, 'America/New_York', false),
  m('clt', 'Charlotte', 'NC', 35.2271, -80.8431, 'America/New_York', false),
  m('rdu', 'Raleigh–Durham', 'NC', 35.9132, -79.0558, 'America/New_York', false),
  m('slc', 'Salt Lake City', 'UT', 40.7608, -111.891, 'America/Denver', false),
  m('cmh', 'Columbus', 'OH', 39.9612, -82.9988, 'America/New_York', false),
  m('cle', 'Cleveland', 'OH', 41.4993, -81.6944, 'America/New_York', false),
  m('cin', 'Cincinnati', 'OH', 39.1031, -84.512, 'America/New_York', false),
  m('ind', 'Indianapolis', 'IN', 39.7684, -86.1581, 'America/Indiana/Indianapolis', false),
  m('mke', 'Milwaukee', 'WI', 43.0389, -87.9065, 'America/Chicago', false),
  m('sat', 'San Antonio', 'TX', 29.4241, -98.4936, 'America/Chicago', false),
  m('sac', 'Sacramento', 'CA', 38.5816, -121.4944, 'America/Los_Angeles', false),
  m('cgy', 'Calgary', 'AB', 51.0447, -114.0719, 'America/Edmonton', false),
  m('edm', 'Edmonton', 'AB', 53.5461, -113.4938, 'America/Edmonton', false),
  m('ott', 'Ottawa', 'ON', 45.4215, -75.6972, 'America/Toronto', false),
  m('wpg', 'Winnipeg', 'MB', 49.8951, -97.1384, 'America/Winnipeg', false),
  m('yqb', 'Québec City', 'QC', 46.8139, -71.208, 'America/Toronto', false),
  m('hfx', 'Halifax', 'NS', 44.6488, -63.5752, 'America/Halifax', false),
];

export const DEFAULT_METRO: Metro = METROS[0];

export function metroById(id: string | undefined): Metro | undefined {
  return METROS.find((x) => x.id === id);
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

/** Lower-case and strip accents so "montreal" finds Montréal. */
export function normalizeSearch(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
