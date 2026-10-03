/**
 * Polite fetching for venue pages: identifies itself, obeys robots.txt, spaces requests per host, sends conditional
 * requests, and gives up (never works around) when it meets a block, a login page or a bot wall.
 * No cookies, no logins, no CAPTCHA solving, no proxies.
 */
import { isAllowed, parseRobots, robotsFromStatus, type RobotsRules } from '../../supabase/functions/_shared/robots';

export const CONTACT_URL = process.env.BOT_CONTACT_URL ?? 'https://hbnmusic.github.io/Show-up-app/bot.html';
export const USER_AGENT = `PullUpBot/1.0 (+${CONTACT_URL})`;
export const MIN_DELAY_MS = Number(process.env.SCAN_MIN_DELAY_MS ?? 3000);

export type FetchRes = { status: number; headers: { get(n: string): string | null }; text(): Promise<string> };
export type FetchFn = (url: string, init: { headers: Record<string, string>; redirect: 'follow'; signal?: AbortSignal }) => Promise<FetchRes>;

export type Outcome =
  | { kind: 'ok'; status: number; body: string; etag?: string; lastModified?: string; contentType: string }
  | { kind: 'not_modified' }
  | { kind: 'robots_disallowed' }
  | { kind: 'bot_wall'; why: string }
  | { kind: 'error'; why: string };

const WALL_HEADERS = ['cf-mitigated'];
const WALL_TEXT = /just a moment\.\.\.|attention required! \| cloudflare|captcha|verify you are (?:a )?human|access denied|enable javascript and cookies to continue|ddos protection by|are you a robot|px-captcha|incapsula incident/i;

/** True for a page that is a block or challenge rather than content. */
export function looksBlocked(status: number, headers: { get(n: string): string | null }, body: string): string | null {
  if (WALL_HEADERS.some((h) => headers.get(h))) return 'challenge header';
  if ([401, 403, 429, 451].includes(status)) return `status ${status}`;
  if (status === 503 && WALL_TEXT.test(body.slice(0, 5000))) return 'challenge page';
  if (status === 200 && body.length < 20000 && WALL_TEXT.test(body.slice(0, 20000)) && !/application\/ld\+json|BEGIN:VEVENT/i.test(body)) return 'challenge page';
  return null;
}

export class PoliteFetcher {
  private robots = new Map<string, RobotsRules | 'deny' | 'allow'>();
  private lastHit = new Map<string, number>();

  constructor(private doFetch: FetchFn = fetch as unknown as FetchFn, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), private now: () => number = Date.now, private ua = USER_AGENT) {}

  private async wait(host: string, delaySec?: number) {
    const gap = Math.max(MIN_DELAY_MS, (delaySec ?? 0) * 1000);
    const last = this.lastHit.get(host);
    if (last != null) {
      const left = last + gap - this.now();
      if (left > 0) await this.sleep(left);
    }
    this.lastHit.set(host, this.now());
  }

  private async raw(url: string, headers: Record<string, string> = {}): Promise<FetchRes> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      return await this.doFetch(url, { headers: { 'user-agent': this.ua, accept: 'text/html,application/xhtml+xml,text/calendar,application/rss+xml,application/json;q=0.9,*/*;q=0.5', ...headers }, redirect: 'follow', signal: ctl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /** robots.txt for a host: fetched once per run. A missing file allows everything; an error or block denies. */
  async rulesFor(origin: string): Promise<RobotsRules | 'deny' | 'allow'> {
    const cached = this.robots.get(origin);
    if (cached) return cached;
    const host = new URL(origin).host;
    await this.wait(host);
    let rules: RobotsRules | 'deny' | 'allow';
    try {
      const res = await this.raw(`${origin}/robots.txt`);
      const body = await res.text();
      if (looksBlocked(res.status, res.headers, body) && res.status !== 404) rules = 'deny';
      else {
        const mode = robotsFromStatus(res.status);
        rules = mode === 'parse' ? parseRobots(body, this.ua) : mode === 'allow_all' ? 'allow' : 'deny';
      }
    } catch {
      rules = 'deny';
    }
    this.robots.set(origin, rules);
    return rules;
  }

  async get(url: string, cond: { etag?: string | null; lastModified?: string | null } = {}): Promise<Outcome> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { kind: 'error', why: 'bad url' };
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'error', why: 'bad scheme' };
    const rules = await this.rulesFor(u.origin);
    if (rules === 'deny') return { kind: 'robots_disallowed' };
    if (rules !== 'allow' && !isAllowed(rules, u.pathname + u.search)) return { kind: 'robots_disallowed' };
    await this.wait(u.host, rules !== 'allow' ? rules.crawlDelaySec : undefined);
    const headers: Record<string, string> = {};
    if (cond.etag) headers['if-none-match'] = cond.etag;
    if (cond.lastModified) headers['if-modified-since'] = cond.lastModified;
    try {
      const res = await this.raw(url, headers);
      if (res.status === 304) return { kind: 'not_modified' };
      const body = await res.text();
      const wall = looksBlocked(res.status, res.headers, body);
      if (wall) return { kind: 'bot_wall', why: wall };
      if (res.status < 200 || res.status >= 300) return { kind: 'error', why: `status ${res.status}` };
      return { kind: 'ok', status: res.status, body: body.slice(0, 3_000_000), etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined, contentType: res.headers.get('content-type') ?? '' };
    } catch (e) {
      return { kind: 'error', why: e instanceof Error ? e.message.slice(0, 80) : 'fetch failed' };
    }
  }
}
