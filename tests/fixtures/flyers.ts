/**
 * Synthetic flyers: invented bands, invented venues, recognised-text strings written by hand. No real flyer
 * or real artist appears here. `model` is a recorded model response, so no test calls a live model.
 */
import type { MetroRow, VenueRow } from '../../supabase/functions/_shared/types.ts';

export const METROS: MetroRow[] = [
  { id: 'nyc', name: 'New York', state: 'NY', tz: 'America/New_York', aliases: ['Brooklyn', 'Queens', 'Manhattan'] },
  { id: 'mtl', name: 'Montréal', state: 'QC', tz: 'America/Toronto', aliases: ['Montreal'] },
  { id: 'chi', name: 'Chicago', state: 'IL', tz: 'America/Chicago' },
  { id: 'tor', name: 'Toronto', state: 'ON', tz: 'America/Toronto' },
];

export const REGISTRY: VenueRow[] = [
  { id: 'v-parkside', name: 'Parkside Hall', aliases: ['Parkside'], metro: 'nyc', address: '100 Example Ave, Brooklyn, NY', neighborhood: 'Williamsburg' },
  { id: 'v-lanterne', name: 'La Lanterne', aliases: [], metro: 'mtl', address: '200 rue Exemple, Montréal, QC', neighborhood: 'Plateau' },
  { id: 'v-rustbelt', name: 'Rust Belt Room', aliases: [], metro: 'chi', address: '300 W Example St, Chicago, IL' },
];

export const f = (value: string, source: string, confidence = 0.95) => ({ value, source_text: source, confidence });
export const none = null;

type Ev = Record<string, unknown>;
export const ev = (o: { headliner?: ReturnType<typeof f> | null; supports?: ReturnType<typeof f>[]; venue?: ReturnType<typeof f> | null; address?: ReturnType<typeof f> | null; city?: ReturnType<typeof f> | null; date?: ReturnType<typeof f> | null; weekday?: ReturnType<typeof f> | null; doors?: ReturnType<typeof f> | null; start?: ReturnType<typeof f> | null; price?: ReturnType<typeof f> | null; age_policy?: ReturnType<typeof f> | null; ticket_url?: ReturnType<typeof f> | null; genre?: ReturnType<typeof f> | null }): Ev => ({
  headliner: null, venue: null, address: null, city: null, date: null, weekday: null, doors: null, start: null, price: null, age_policy: null, ticket_url: null, genre: null, supports: [], ...o,
});
export const resp = (events: Ev[], flags: { is_flyer?: boolean; is_safe?: boolean } = {}) => ({ is_flyer: true, is_safe: true, events, ...flags });

/** "Today" for all flyer tests: Saturday 2026-10-03, 12:00 New York. */
export const NOW = new Date('2026-10-03T16:00:00Z');

export const BROOKLYN = {
  ocr: `PARKSIDE HALL PRESENTS
VELVET AUTOMATON
w/ Gentle Moth + Tin Orchard
FRI OCT 16 · DOORS 7PM · SHOW 8PM
$15 ADV / $18 DOOR · ALL AGES
Parkside Hall, Williamsburg Brooklyn
tickets: parksidehall.example/velvet
IG @velvetautomaton`,
  model: resp([
    ev({
      headliner: f('Velvet Automaton', 'VELVET AUTOMATON'),
      supports: [f('Gentle Moth', 'Gentle Moth'), f('Tin Orchard', 'Tin Orchard')],
      venue: f('Parkside Hall', 'Parkside Hall'),
      city: f('Brooklyn', 'Williamsburg Brooklyn'),
      date: f('FRI OCT 16', 'FRI OCT 16'),
      doors: f('7PM', 'DOORS 7PM'),
      start: f('8PM', 'SHOW 8PM'),
      price: f('$15 ADV / $18 DOOR', '$15 ADV / $18 DOOR'),
      age_policy: f('ALL AGES', 'ALL AGES'),
      ticket_url: f('parksidehall.example/velvet', 'parksidehall.example/velvet'),
    }),
  ]),
};

export const MONTREAL_FR = {
  ocr: `LA LANTERNE
SPECTACLE
NUIT BLANCHE
vendredi 16 octobre
portes 20 h · spectacle 21 h 30
15 $ à l'avance / 20 $ à la porte
Montréal`,
  model: resp([
    ev({
      headliner: f('Nuit Blanche', 'NUIT BLANCHE'),
      venue: f('La Lanterne', 'LA LANTERNE'),
      city: f('Montréal', 'Montréal'),
      date: f('vendredi 16 octobre', 'vendredi 16 octobre'),
      doors: f('20 h', 'portes 20 h'),
      start: f('21 h 30', 'spectacle 21 h 30'),
      price: f("15 $ à l'avance / 20 $ à la porte", "15 $ à l'avance / 20 $ à la porte"),
    }),
  ]),
};

export const TOUR = {
  ocr: `OCTOBER TOUR
GLASS HARBOR
10/16 New York — Parkside Hall
10/17 Chicago — Rust Belt Room
10/19 Denver — Fox Lodge
10/20 Toronto — Unknown Cellar`,
  model: resp([
    ev({ headliner: f('Glass Harbor', 'GLASS HARBOR'), venue: f('Parkside Hall', 'Parkside Hall'), city: f('New York', '10/16 New York'), date: f('10/16', '10/16 New York') }),
    ev({ headliner: f('Glass Harbor', 'GLASS HARBOR'), venue: f('Rust Belt Room', 'Rust Belt Room'), city: f('Chicago', '10/17 Chicago'), date: f('10/17', '10/17 Chicago') }),
    ev({ headliner: f('Glass Harbor', 'GLASS HARBOR'), venue: f('Fox Lodge', 'Fox Lodge'), city: f('Denver', '10/19 Denver'), date: f('10/19', '10/19 Denver') }),
    ev({ headliner: f('Glass Harbor', 'GLASS HARBOR'), venue: f('Unknown Cellar', 'Unknown Cellar'), city: f('Toronto', '10/20 Toronto'), date: f('10/20', '10/20 Toronto') }),
  ]),
};

export const BASEMENT = {
  ocr: `HOUSE SHOW
SALT LICK DIVISION
SAT OCT 17 · 8PM · $10
DM for address
Brooklyn`,
  model: resp([
    ev({
      headliner: f('Salt Lick Division', 'SALT LICK DIVISION'),
      venue: f('House Show', 'HOUSE SHOW'),
      address: f('DM for address', 'DM for address'),
      city: f('Brooklyn', 'Brooklyn'),
      date: f('SAT OCT 17', 'SAT OCT 17'),
      start: f('8PM', '8PM'),
      price: f('$10', '$10'),
    }),
  ]),
};

export const WRONG_WEEKDAY = {
  ocr: `PARKSIDE HALL\nPAPER LANTERNS\nSAT OCT 16\n8PM`,
  model: resp([
    ev({ headliner: f('Paper Lanterns', 'PAPER LANTERNS'), venue: f('Parkside Hall', 'PARKSIDE HALL'), date: f('SAT OCT 16', 'SAT OCT 16'), start: f('8PM', '8PM') }),
  ]),
};

export const UNSUPPORTED_FIELDS = {
  ocr: `PARKSIDE HALL\nHONEY RADIO\nFRI OCT 16`,
  model: resp([
    ev({
      headliner: f('Honey Radio', 'HONEY RADIO'),
      venue: f('Parkside Hall', 'PARKSIDE HALL'),
      date: f('FRI OCT 16', 'FRI OCT 16'),
      // Invented by the model: neither quote is in the text.
      price: f('$25', '$25 advance'),
      genre: f('Punk', 'punk rock night'),
    }),
  ]),
};
