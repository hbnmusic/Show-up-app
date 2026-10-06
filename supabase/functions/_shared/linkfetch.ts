/**
 * Fetch ONE public page a person shared (logged out, no cookies) and read its preview image and caption.
 * Used by the phone first; the link-fetch function is the fallback when the phone cannot get it. Only the image
 * address and the caption text are returned. Nothing else on the page is read and the page is not stored.
 */
export const BOT_UA = 'ComeThruBot/1.0 (+https://hbnmusic.github.io/Show-up-app/bot.html)';

export type Preview = { imageUrl?: string; caption?: string; title?: string };

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

/** Rejects anything that is not a plain public https address: no IP literals, localhost, internal names or credentials. */
export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost') || h === 'localhost') return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || /^\[/.test(h)) return false;
  return true;
}

function meta(html: string, keys: string[]): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !keys.includes(name)) continue;
    const content = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = content?.[1] ?? content?.[2];
    if (v && v.trim()) return decode(v.trim());
  }
  return undefined;
}

export function parsePreview(html: string, baseUrl: string): Preview {
  const head = html.slice(0, 400_000);
  const image = meta(head, ['og:image', 'og:image:url', 'twitter:image']);
  let imageUrl: string | undefined;
  if (image) {
    try {
      const u = new URL(image, baseUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') imageUrl = u.toString();
    } catch { /* ignore */ }
  }
  return { imageUrl, caption: meta(head, ['og:description', 'description', 'twitter:description'])?.slice(0, 2000), title: meta(head, ['og:title', 'twitter:title'])?.slice(0, 200) };
}

type Fetcher = (url: string, init: { redirect: 'manual'; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

/** Follows up to 3 redirects, re-checking every hop. Returns null when nothing usable was found. */
export async function fetchPreview(url: string, doFetch: Fetcher = fetch as unknown as Fetcher): Promise<Preview | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafeUrl(current)) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await doFetch(current, { redirect: 'manual', headers: { 'user-agent': BOT_UA, accept: 'text/html', 'accept-language': 'en' }, signal: ctl.signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        current = new URL(loc, current).toString();
        continue;
      }
      if (res.status !== 200) return null;
      if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null;
      const p = parsePreview(await res.text(), current);
      return p.imageUrl || p.caption ? p : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
