/** Plain-language status of flyer jobs, and which finished jobs need a notification. Pure, so it is tested without a phone. */
import type { Job } from '../fp/api';

export type JobView = { id: string; tone: 'working' | 'live' | 'waiting' | 'no'; title: string; detail: string };

/** Shown when the flyer_intake_enabled switch is off. Nothing is read or sent. */
export const FLYER_PAUSED_MESSAGE = 'Flyer sharing is paused right now. Nothing was sent.';
/**
 * What the share screen does before touching anything: wait for the saved switch values, stop with the paused message
 * (no sign-in, no OCR, no server contact), or go.
 */
export const intakeGate = (flagsLoaded: boolean, intakeOn: boolean): 'wait' | 'paused' | 'go' => (!flagsLoaded ? 'wait' : intakeOn ? 'go' : 'paused');

/** Shown when flyers are received but the reader (ai_extraction_enabled) is paused. */
export const READER_PAUSED_TEXT = 'Received. Reading flyers is paused for a short while, so yours is in line and will be processed when it resumes.';

const REASONS: Record<string, string> = {
  banned: 'This account cannot share flyers.',
  not_a_flyer: 'That did not look like a concert flyer.',
  unsafe: 'That content cannot be listed.',
  quota_gave_up: 'We were too busy to read it. Please share it again later.',
  removed_or_blocked: 'The show was removed or blocked.',
  no_events: 'No show with a future date and venue could be found on it.',
  past_date: 'The date on it has passed.',
  weekday_mismatch: 'The weekday and date on it do not match, so it was not listed.',
  too_far: 'The date is more than a year away.',
};

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return 'We could not use that flyer.';
  return REASONS[reason] ?? 'We could not use that flyer.';
}

const names = (j: Job) => j.shows.map((s) => s.headliner).filter(Boolean).slice(0, 3).join(', ');

export function viewJob(j: Job): JobView {
  if (j.result === 'processing' || (j.status !== 'done' && j.status !== 'failed')) {
    const detail = j.status === 'retry' ? 'The reader is busy; we will try again automatically.' : j.status === 'queued' ? 'In line. Reading is paused for a short while; it will be read when it resumes.' : 'This usually takes a few seconds.';
    return { id: j.id, tone: 'working', title: 'Reading your flyer', detail };
  }
  // A show another person confirmed after this job finished is live even though the job still says pending.
  const confirmedSince = j.result === 'pending' && j.shows.length > 0 && j.shows.every((x) => x.visibility === 'public');
  if (j.result === 'published' || confirmedSince) return { id: j.id, tone: 'live', title: names(j) ? `Live: ${names(j)}` : 'Live', detail: 'It is on the deck for everyone.' };
  if (j.result === 'pending') {
    return {
      id: j.id, tone: 'waiting', title: names(j) ? `Waiting: ${names(j)}` : 'Waiting for confirmation',
      detail: j.reason === 'low_confidence' ? 'Some details were hard to read. Only you can see it until a second person confirms it.' : 'Only you can see it until a second person confirms it.',
    };
  }
  return { id: j.id, tone: 'no', title: 'Not listed', detail: reasonText(j.reason) };
}

export type Notice = { jobId: string; title: string; body: string };

/** Finished jobs the person has not been told about yet: live, needs a second confirmation, or could not be used. */
export function noticesFor(jobs: Job[]): Notice[] {
  const out: Notice[] = [];
  for (const j of jobs) {
    if (j.notified) continue;
    if (j.status !== 'done' && j.status !== 'failed') continue;
    const v = viewJob(j);
    if (v.tone === 'live') out.push({ jobId: j.id, title: 'Your flyer is live', body: v.title.replace(/^Live: ?/, '') || 'Your show is on the deck.' });
    else if (v.tone === 'waiting') out.push({ jobId: j.id, title: 'Your flyer needs a second confirmation', body: v.title.replace(/^Waiting: ?/, '') || 'Another person has to confirm it.' });
    else if (v.tone === 'no') out.push({ jobId: j.id, title: "We couldn't list your flyer", body: v.detail });
  }
  return out;
}

/** A pending show is gone from the person's view once the jobs say it is live; used to refresh the deck once. */
export const anyLive = (jobs: Job[]) => jobs.some((j) => j.result === 'published');

/** What a person is told right after sharing a flyer that was accepted for review. */
export const THANKS_TITLE = 'Thank you!';
export const THANKS_BODY = 'We received your flyer and it is being reviewed to be added to the listings. Until it is confirmed, only you can see it.';
/** The confirmation rules in plain words (they match publish.ts and the confirm button). */
export const CONFIRMATION_RULES = 'A show is confirmed when the details are clear and one more source agrees: another person shares the same show, the venue lists it on its own site, or another signed-in person taps "Yes, this is real" in Help confirm. Once you have had three shows confirmed by others, your later flyers can go live straight away.';

export type SubmittedState = 'reading' | 'verified' | 'waiting' | 'removed' | 'not_listed';
export type SubmittedRow = { key: string; jobId: string; showId?: string; state: SubmittedState; label: string; title: string; when?: string; detail: string };

const STATE_LABEL: Record<SubmittedState, string> = { reading: 'Reading', verified: 'Verified', waiting: 'Awaiting confirmation', removed: 'Removed', not_listed: 'Not listed' };

/** "Fri, Oct 16" from a YYYY-MM-DD date, without time-zone shifts. */
export function dayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The Submitted tab: one row per show a person's flyers produced, plus rows for flyers still being read or not listed. */
export function submittedRows(jobs: Job[]): SubmittedRow[] {
  const rows: SubmittedRow[] = [];
  for (const j of jobs) {
    const row = (state: SubmittedState, title: string, detail: string, extra: Partial<SubmittedRow> = {}): SubmittedRow => ({ key: `${j.id}${extra.showId ? `:${extra.showId}` : ''}`, jobId: j.id, state, label: STATE_LABEL[state], title, detail, ...extra });
    if (j.status !== 'done' && j.status !== 'failed') {
      rows.push(row('reading', 'Reading your flyer', j.status === 'retry' ? 'The reader is busy; we will try again automatically.' : 'This usually takes a few seconds.'));
      continue;
    }
    if ((j.result === 'published' || j.result === 'pending') && j.shows.length > 0) {
      for (const s of j.shows) {
        const when = [s.venueName, dayLabel(s.localDate)].filter(Boolean).join(' · ');
        const common = { showId: s.id, when };
        if (s.visibility === 'public') rows.push(row('verified', s.headliner, j.result === 'pending' ? 'Confirmed. It is on the deck for everyone.' : 'It is on the deck for everyone.', common));
        else if (s.visibility === 'pending') rows.push(row('waiting', s.headliner, j.reason === 'low_confidence' ? 'Some details were hard to read. Only you can see it until a second source confirms it.' : 'Only you can see it until a second source confirms it.', common));
        else rows.push(row('removed', s.headliner, 'This show was removed.', common));
      }
      continue;
    }
    rows.push(row('not_listed', 'Flyer not listed', reasonText(j.reason)));
  }
  return rows;
}
