import type { Show } from './types';
import { formatDay, formatTime, wall } from './time';

export function headliner(s: Show): string {
  const top = [...s.acts].sort((a, b) => a.order - b.order)[0];
  return top?.name ?? s.title ?? 'Show';
}

/** Card title: a named night, or the headliner. */
export function showTitle(s: Show): string {
  return s.title && s.acts.length === 0 ? s.title : headliner(s);
}

export function supportActs(s: Show): string[] {
  return [...s.acts].sort((a, b) => a.order - b.order).slice(1).map((a) => a.name);
}

export function doorsDate(s: Show): Date {
  return new Date(s.doorsAt ?? s.startsAt);
}

export function endDate(s: Show): Date {
  if (s.endsAt) return new Date(s.endsAt);
  return new Date(new Date(s.startsAt).getTime() + 3 * 60 * 60 * 1000);
}

export function timeLabel(s: Show): string {
  if (s.timeTba) return 'Time TBA';
  const start = wall(s.startsAt);
  if (s.doorsAt) return `Doors ${formatTime(wall(s.doorsAt))} · ${formatTime(start)}`;
  return formatTime(start);
}

export function dateTimeLabel(s: Show): string {
  return `${formatDay(wall(s.startsAt))} · ${timeLabel(s)}`;
}

export function priceLabel(s: Show): string {
  const p = s.price;
  if (p.isFree) return 'Free';
  if (p.notaflof) return 'Sliding scale';
  if (p.min != null && p.max != null && p.min !== p.max) return `$${p.min}–$${p.max}`;
  if (p.min != null) return `$${p.min}`;
  if (p.max != null) return `$${p.max}`;
  return 'Price TBA';
}

export const priceKnown = (s: Show) => !!s.price.isFree || !!s.price.notaflof || s.price.min != null || s.price.max != null;

/**
 * The facts to list for a show, leaving out what the listing does not say.
 * A card full of "TBA" tells nobody anything, so when the price is not
 * known a single line points to the ticket page instead.
 */
export function factsFor(s: Show): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (priceKnown(s)) out.push({ label: 'Cost', value: priceLabel(s) });
  if (out.length === 0) out.push({ label: 'Cost', value: s.ticketUrl ? 'On the ticket page' : 'Ask the venue' });
  return out;
}

/** One line for the card and the Going list: only what is known. */
export function metaLine(s: Show): string {
  const parts: string[] = [];
  if (priceKnown(s)) parts.push(priceLabel(s));
  return parts.join(' · ');
}

export function placeLabel(s: Show): string {
  return `${s.venue.name} · ${s.venue.neighborhood}`;
}

/** What goes in a calendar event's location field, respecting private addresses. */
export function calendarLocation(s: Show): string {
  const v = s.venue;
  if (v.addressVisibility !== 'public') return `${v.neighborhood}, ${v.city} (address on request)`;
  if (v.address) return `${v.name}, ${v.address}, ${v.city}`;
  return `${v.name}, ${v.neighborhood}, ${v.city}`;
}

export function fullBill(s: Show): string {
  return [...s.acts]
    .sort((a, b) => a.order - b.order)
    .map((a) => a.name)
    .join(', ');
}
