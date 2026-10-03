import { deviceInfo, getInstallId } from './analytics';
import { track } from './analyticsCore';
import { feedbackErrors, type FeedbackKind } from './feedbackCore';

export { FEEDBACK_KINDS, FEEDBACK_MAX, feedbackErrors, type FeedbackKind } from './feedbackCore';

/** Sends feedback to the owner-only table. Returns an error message, or null when sent. */
export async function sendFeedback(kind: FeedbackKind, message: string, email: string): Promise<string | null> {
  const errors = feedbackErrors(message, email);
  if (errors.length) return errors[0];
  try {
    const { supabase } = await import('./supabase');
    if (!supabase) return 'Feedback is not set up in this build.';
    const { error } = await supabase.rpc('submit_feedback', {
      p: { install_id: await getInstallId(), kind, message: message.trim(), contact_email: email.trim() || null, ...deviceInfo() },
    });
    if (error) return error.message;
    track('feedback_sent', { kind });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not send. Check your connection and try again.';
  }
}
