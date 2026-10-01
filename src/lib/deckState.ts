import { create } from 'zustand';

/**
 * pinnedId: the card currently on top of the deck. It stays on top through
 * filter changes as long as it still matches, so nothing jumps mid-preview.
 *
 * deckDetails: the full-details screen was opened from the deck, so the deck's
 * preview keeps playing underneath it. detailsPlaying: the user started an
 * act's preview on that screen, which takes over the audio.
 */
export const useDeckState = create<{ pinnedId: string | null; deckDetails: boolean; detailsPlaying: boolean }>()(() => ({
  pinnedId: null,
  deckDetails: false,
  detailsPlaying: false,
}));
