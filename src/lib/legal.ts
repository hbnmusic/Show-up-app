/**
 * Legal links and versions. TERMS_VERSION must equal pu_terms_version() in the Supabase schema; bump both
 * when the Terms change in a way people must accept again.
 */
export const TERMS_VERSION = '2026-10-04';

/** The app's name and the link shared with friends. Rename here only. Until there is a Play listing the link is the docs home page. */
export const APP_NAME = 'Come Thru';
export const APP_SHARE_URL = 'https://hbnmusic.github.io/Show-up-app';

/** Where docs/ is published (GitHub Pages). */
export const DOCS_URL = 'https://hbnmusic.github.io/Show-up-app';
export const PRIVACY_URL = `${DOCS_URL}/privacy.html`;
export const TERMS_URL = `${DOCS_URL}/terms.html`;
export const DELETE_ACCOUNT_URL = `${DOCS_URL}/delete-account.html`;

/** Support address shown in the app. Replace before release (also in docs/). */
export const SUPPORT_EMAIL = 'support@example.com';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Come Thru support')}`;

/** Reasons offered when reporting a show or a person. */
export const REPORT_REASONS = ['Fake or wrong show', 'Spam or advertising', 'Offensive or harassing', 'Something else'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Copyright (DMCA) notice page. */
export const DMCA_URL = `${DOCS_URL}/dmca.html`;
