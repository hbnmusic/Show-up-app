/** Plain-language status of flyer jobs, and which finished jobs need a notification. Pure, so it is tested without a phone. */
import type { Job } from '../fp/api';

export type JobView = { id: string; tone: 'working' | 'live' | 'waiting' | 'no'; title: string; detail: string };

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
    return { id: j.id, tone: 'working', title: 'Reading your flyer', detail: j.status === 'retry' ? 'The reader is busy; we will try again automatically.' : 'This usually takes a few seconds.' };
  }
  if (j.result === 'published') return { id: j.id, tone: 'live', title: names(j) ? `Live: ${names(j)}` : 'Live', detail: 'It is on the deck for everyone.' };
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
