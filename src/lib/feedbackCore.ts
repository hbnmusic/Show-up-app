/** Feedback form rules, free of native imports so they can be tested. */
export const FEEDBACK_KINDS = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'other', label: 'Other' },
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['id'];
export const FEEDBACK_MAX = 2000;

/** Problems with the form, one message each. Empty means it can be sent. */
export function feedbackErrors(message: string, email: string): string[] {
  const errors: string[] = [];
  const m = message.trim();
  if (!m) errors.push('Write a message first.');
  if (m.length > FEEDBACK_MAX) errors.push(`The message can be up to ${FEEDBACK_MAX} characters.`);
  const e = email.trim();
  if (e && (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) errors.push('That email address does not look right.');
  return errors;
}

