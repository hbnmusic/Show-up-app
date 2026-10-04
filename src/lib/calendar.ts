import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import { currentPriceUi } from '../hooks/usePriceUi';
import { track } from './analyticsCore';
import { calendarLocation, doorsDate, endDate, fullBill, metaLine, showTitle } from './showText';
import type { Show } from './types';

/**
 * Open the phone's own new-event form, pre-filled. On Android this needs no
 * calendar permission; the trade-off is the app never learns the event's id,
 * so it can't update the event later (see the spec's Calendar section).
 */
export async function addToCalendar(show: Show): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const notes = [
    `Lineup: ${fullBill(show) || show.title || ''}`,
    metaLine(show, currentPriceUi()),
    show.ticketUrl ? `Listing: ${show.ticketUrl}` : '',
    `Open in Pull Up: pullup://show/${show.id}`,
  ]
    .filter(Boolean)
    .join('\n');
  await createEventInCalendarAsync({
    title: `${showTitle(show)} at ${show.venue.name}`,
    startDate: show.timeTba ? new Date(show.startsAt) : doorsDate(show),
    endDate: endDate(show),
    allDay: !!show.timeTba,
    location: calendarLocation(show),
    notes,
  });
  track('calendar_added');
  return true;
}
