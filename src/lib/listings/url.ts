import { LISTINGS_FEED_URL_TEMPLATE } from '../hosting';

/**
 * Where the refresh job publishes each city's feed; {metro} is replaced by the city id.
 * Override at build time with EXPO_PUBLIC_LISTINGS_URL.
 */
export const LISTINGS_URL =
  process.env.EXPO_PUBLIC_LISTINGS_URL ?? LISTINGS_FEED_URL_TEMPLATE;

export const listingsUrl = (metro: string) => LISTINGS_URL.replace('{metro}', metro);
