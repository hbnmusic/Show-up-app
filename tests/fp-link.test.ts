import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fetchPreview, isSafeUrl, parsePreview } from '../supabase/functions/_shared/linkfetch.ts';

const html = `<html><head><meta property="og:image" content="https://cdn.example/p.jpg?a=1&amp;b=2"><meta property='og:description' content='Fri Oct 16 &quot;Velvet Automaton&quot; at Parkside Hall'><meta name="twitter:title" content="Post"></head></html>`;
const res = (status: number, body = '', headers: Record<string, string> = { 'content-type': 'text/html' }) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body });

describe('link preview fetch', () => {
  it('reads the preview image and caption', () => {
    const p = parsePreview(html, 'https://social.example/p/1');
    assert.equal(p.imageUrl, 'https://cdn.example/p.jpg?a=1&b=2');
    assert.equal(p.caption, 'Fri Oct 16 "Velvet Automaton" at Parkside Hall');
    assert.equal(p.title, 'Post');
  });

  it('refuses unsafe addresses', () => {
    for (const u of ['http://a.example/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://svc.internal/x', 'https://user:pw@a.example/x', 'https://a.example:8443/x', 'file:///etc/passwd', 'not a url', 'https://intranet/x'])
      assert.equal(isSafeUrl(u), false, u);
    assert.equal(isSafeUrl('https://www.example.com/p/abc'), true);
  });

  it('sends the bot user agent, never cookies, and returns the preview', async () => {
    let seen: Record<string, string> = {};
    const p = await fetchPreview('https://social.example/p/1', async (_u, init) => { seen = init.headers; return res(200, html); });
    assert.ok(p?.imageUrl);
    assert.match(seen['user-agent'], /SetnikBot/);
    assert.ok(!('cookie' in seen) && !('authorization' in seen));
  });

  it('follows redirects but re-checks every hop, and gives up on a login wall or non-HTML', async () => {
    const hops = ['https://a.example/x', 'https://b.example/y'];
    const ok = await fetchPreview('https://a.example/x', async (u) => (u === hops[0] ? res(302, '', { location: hops[1] }) : res(200, html)));
    assert.ok(ok);
    assert.equal(await fetchPreview('https://a.example/x', async () => res(302, '', { location: 'https://127.0.0.1/admin' })), null);
    assert.equal(await fetchPreview('https://a.example/x', async () => res(302, '', { location: 'http://b.example/y' })), null);
    assert.equal(await fetchPreview('https://a.example/x', async () => res(403)), null);
    assert.equal(await fetchPreview('https://a.example/x', async () => res(200, '<html></html>')), null);
    assert.equal(await fetchPreview('https://a.example/x', async () => res(200, html, { 'content-type': 'image/png' })), null);
    assert.equal(await fetchPreview('https://a.example/x', async () => { throw new Error('net'); }), null);
    let n = 0;
    assert.equal(await fetchPreview('https://a.example/x', async () => { n++; return res(302, '', { location: 'https://a.example/x' }); }), null);
    assert.equal(n, 4);
  });
});
