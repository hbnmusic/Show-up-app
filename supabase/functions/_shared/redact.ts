/**
 * Removes personal details from recognised flyer text before it leaves the phone: email addresses, phone
 * numbers and social handles or profile links. Ticket and event links are kept because the show needs them.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SOCIAL_URL = /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|threads\.net|twitter\.com|x\.com|linktr\.ee)\/[^\s]*/gi;
const HANDLE = /(^|[\s(])@[A-Za-z0-9._]{2,30}/g;
// 7+ digits with common separators, with or without a country code or area-code brackets.
const PHONE = /(?<![\d$.])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

export function redactText(text: string): string {
  return text
    .replace(EMAIL, '[email removed]')
    .replace(SOCIAL_URL, '[social link removed]')
    .replace(HANDLE, '$1[handle removed]')
    .replace(PHONE, '[phone removed]');
}
