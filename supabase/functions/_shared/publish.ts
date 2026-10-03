/** Publishing rule for flyers: auto-publish only when confidence is high AND something else corroborates it. */
export const HIGH_CONFIDENCE = 0.85;

export type PublishInput = { confidence: number; corroborated: boolean; trusted: boolean };
export type PublishDecision = 'publish' | 'pending';

export function decidePublish(i: PublishInput, threshold = HIGH_CONFIDENCE): PublishDecision {
  return i.confidence >= threshold && (i.corroborated || i.trusted) ? 'publish' : 'pending';
}

/** Why a flyer show stayed pending, for the person who shared it. */
export function pendingReason(i: PublishInput, threshold = HIGH_CONFIDENCE): 'low_confidence' | 'needs_confirmation' | null {
  if (i.confidence < threshold) return 'low_confidence';
  if (!i.corroborated && !i.trusted) return 'needs_confirmation';
  return null;
}

/** Submitter becomes trusted after this many of their shows were confirmed by others and none removed. */
export const TRUSTED_AFTER_CONFIRMED = 3;
