import { create } from 'zustand';

/**
 * The card currently on top of the deck. It stays on top through filter
 * changes as long as it still matches, so nothing jumps mid-preview.
 */
export const useDeckState = create<{ pinnedId: string | null }>()(() => ({ pinnedId: null }));
