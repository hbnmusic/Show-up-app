/**
 * Anonymous usage events: the parts that need no native modules, so tests and the store can import them.
 * Events carry a name and a few small scalar properties. Never put an email, a name, a show title, free text,
 * a location or any other personal data in them. The server drops anything outside this list (see log_events in supabase/).
 */
export const EVENT_NAMES = [
  'app_open',
  'session_start',
  'screen_view',
  'decision',
  'show_opened',
  'filter_changed',
  'city_changed',
  'calendar_added',
  'community_action',
  'share_received',
  'flyer_shared',
  'flyer_ocr',
  'flyer_result',
  'link_fetch',
  'ai_quota',
  'permission',
  'feedback_sent',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export type Props = Record<string, string | number | boolean>;
export type AnalyticsEvent = { name: EventName; props: Props; at: string };

export const MAX_PROPS = 8;
export const MAX_KEY = 30;
export const MAX_VALUE = 60;
export const MAX_BATCH = 50;
export const MAX_QUEUE = 200;

/** Keeps at most MAX_PROPS scalar properties with short keys and values; drops everything else. */
export function cleanProps(p: Record<string, unknown> | undefined): Props {
  const out: Props = {};
  if (!p) return out;
  for (const [k, v] of Object.entries(p)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (k.length === 0 || k.length > MAX_KEY) continue;
    if (typeof v === 'string') {
      if (v.length > MAX_VALUE) continue;
      out[k] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** A random version-4 style id. Not for security: it only tells one install from another. */
export function uuid(rand: () => number = Math.random): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(rand() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Appends an event, dropping the oldest when the queue is full. Returns the new queue. */
export function enqueue(queue: AnalyticsEvent[], e: AnalyticsEvent): AnalyticsEvent[] {
  const next = [...queue, e];
  return next.length > MAX_QUEUE ? next.slice(next.length - MAX_QUEUE) : next;
}

type Sink = (name: EventName, props: Props) => void;
let sink: Sink | null = null;
const early: { name: EventName; props: Props }[] = [];

/** Called once by the app's analytics module. Events recorded before that are replayed. */
export function setSink(s: Sink | null) {
  sink = s;
  if (s) while (early.length) {
    const e = early.shift()!;
    s(e.name, e.props);
  }
}

/** Record an event. Does nothing visible when analytics is off or not configured. Never throws. */
export function track(name: EventName, props?: Record<string, unknown>) {
  try {
    const clean = cleanProps(props);
    if (sink) sink(name, clean);
    else if (early.length < 50) early.push({ name, props: clean });
  } catch {
    // Analytics must never break the app.
  }
}
