import { create } from 'zustand';

import type { Decision } from './types';

/**
 * pinnedId: the card currently on top of the deck. It stays on top through
 * filter changes as long as it still matches, so nothing jumps mid-preview.
 *
 * deckDetails: the full-details screen was opened from the deck, so the deck's
 * preview keeps playing underneath it. detailsPlaying: the user started an
 * act's preview on that screen, which takes over the audio.
 *
 * swipeRequest: the details screen was swiped left or right. The deck picks it
 * up once the screen has closed and flies that card off, exactly as if it had
 * been swiped there.
 */
export const useDeckState = create<{
  pinnedId: string | null;
  deckDetails: boolean;
  detailsPlaying: boolean;
  swipeRequest: { id: string; d: Decision } | null;
}>()(() => ({
  pinnedId: null,
  deckDetails: false,
  detailsPlaying: false,
  swipeRequest: null,
}));
