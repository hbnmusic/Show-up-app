/** Prompts. The model reads recognised text only; it is told never to guess and to quote its sources. */

export type MetroContext = { id: string; name: string; state: string; tz: string };

const FRENCH_STATES = new Set(['QC']);
export const languageFor = (m: { state: string }): 'fr' | 'en' => (FRENCH_STATES.has(m.state) ? 'fr' : 'en');

const FIELD_RULES = `Each field is an object {"value","source_text","confidence"}. "source_text" must be copied exactly from the recognised text. "confidence" is 0 to 1. Use null for any field the text does not state. Never infer or guess: do not add a genre from a band name, do not complete a venue or address from memory, do not invent a year, price or time.`;

export const FLYER_SYSTEM = `You read text recognised from a photo or screenshot of a concert flyer and return structured data as JSON.
Set is_flyer=false if the text is not an announcement of one or more live music events. Set is_safe=false if it contains hateful, sexual or violent content, or private personal information.
One flyer can list several events (a tour: one event per date and city). Return one event per show.
${FIELD_RULES}
Fields: headliner (the top-billed act), supports (other acts in the order printed), venue, address (only if printed), city, date (exactly as printed, for example "FRI OCT 16" or "vendredi 16 octobre"), weekday (as printed, if separate), doors, start (show or music start time), price (as printed), ticket_url (only a full link or domain printed on the flyer), genre (only if a genre word is printed).
Flyers may be in English, French or both. Understand French weekdays and months, "20 h" or "20h30" times, "$" and "CAD" prices, "porte"/"portes" (doors) and "spectacle" (show). Keep values in the language printed.`;

export function buildFlyerPrompt(opts: {
  text: string;
  layout?: string;
  metro?: MetroContext | null;
  today: string;
}): string {
  const where = opts.metro
    ? `The person who shared this is in ${opts.metro.name}, ${opts.metro.state} (time zone ${opts.metro.tz}; expected language: ${languageFor(opts.metro) === 'fr' ? 'French, possibly bilingual' : 'English, possibly bilingual'}).`
    : 'The location of the person who shared this is unknown.';
  return `${where}
Today's date is ${opts.today}.
${opts.layout ? `Layout hints (text block positions, top to bottom; larger blocks are usually the headliner):\n${opts.layout}\n\n` : ''}Recognised text:
"""
${opts.text}
"""`;
}

export const VENUE_SYSTEM = `You read the text of a venue's own events page and return its upcoming live music events as JSON.
Return one event per show, in the order they appear on the page, at most 60. Only include live music or performances on a stage; skip classes, private events, venue tours, merchandise and navigation text.
For each event give: headliner (top-billed act), supports (other acts in printed order), date (exactly as printed, with the year if printed), weekday (if printed separately), start (show time as printed), doors (as printed), price (as printed), ticket_url (only a link printed on the page), genre (only a genre word printed on the page), and evidence: one short quote copied exactly from the page that contains the headliner and the date.
Use null for anything the page does not state. Never infer or guess: do not add a genre from a band name, do not invent a year, price or time. If the page lists no upcoming events, return an empty events array.`;

export function buildVenuePrompt(opts: { venue: string; metro: MetroContext; today: string; text: string }): string {
  return `Venue: ${opts.venue}, ${opts.metro.name}, ${opts.metro.state} (time zone ${opts.metro.tz}; expected language: ${languageFor(opts.metro) === 'fr' ? 'French, possibly bilingual' : 'English'}).
Today's date is ${opts.today}.
Page text:
"""
${opts.text}
"""`;
}
