import { DOCS_BASE_URL, SHARE_URL } from './hosting';

/**
 * Legal links and versions. TERMS_VERSION must equal setnik_terms_version() in the Supabase schema; bump both
 * when the Terms change in a way people must accept again.
 */
export const TERMS_VERSION = '2026-10-09';

/** The app's name and the link shared with friends. Rename here only. Until there is a Play listing the link is the docs home page. */
export const APP_NAME = 'Setnik';
export const APP_SHARE_URL = SHARE_URL;

/** Where docs/ is published (GitHub Pages); defined in hosting.ts. */
export const DOCS_URL = DOCS_BASE_URL;
export const PRIVACY_URL = `${DOCS_URL}/privacy.html`;
export const TERMS_URL = `${DOCS_URL}/terms.html`;
export const DELETE_ACCOUNT_URL = `${DOCS_URL}/delete-account.html`;

/** Support address shown in the app. Replace before release (also in docs/). */
export const SUPPORT_EMAIL = 'setnik.app@gmail.com';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Setnik support')}`;

/** Reasons offered when reporting a show or a person. */
export const REPORT_REASONS = ['Fake or wrong show', 'Spam or advertising', 'Offensive or harassing', 'Something else'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Copyright (DMCA) notice page. */
export const DMCA_URL = `${DOCS_URL}/dmca.html`;
