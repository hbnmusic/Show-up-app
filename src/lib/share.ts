import { Share } from 'react-native';

import { track } from './analyticsCore';
import { shareMessage, shareOutcome } from './shareText';
import type { Show } from './types';

export type ShareSurface = 'details' | 'going';

/** Opens the system share sheet with plain text only (no image, no file). */
export async function shareShow(show: Show, surface: ShareSurface, going?: number | null): Promise<void> {
  try {
    const result = await Share.share({ message: shareMessage(show, going) });
    track('show_shared', { surface, ...shareOutcome(result) });
  } catch {
    // The sheet could not open; nothing to report.
  }
}
