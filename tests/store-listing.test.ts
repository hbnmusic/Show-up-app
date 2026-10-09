import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const md = readFileSync(new URL('../docs/play/store-listing.md', import.meta.url), 'utf8');

/** The first fenced block after a bold label such as **App name**. */
function field(label: string): string {
  const at = md.indexOf(`**${label}**`);
  assert.ok(at >= 0, `missing ${label}`);
  const m = /```\n([^\n]+)\n```/.exec(md.slice(at));
  assert.ok(m, `no text block after ${label}`);
  return m[1];
}

const BANNED = [
  'free', 'cheap', 'discount', 'sale', 'best', 'top', 'popular', 'leading', 'ultimate', 'number one', '#1', 'download', 'install',
  'try now', 'buy now', 'get it now', 'sign up now', 'click here',
];

function problems(text: string, max: number): string[] {
  const out: string[] = [];
  if ([...text].length > max) out.push(`${[...text].length} characters (limit ${max})`);
  if (/\p{Extended_Pictographic}/u.test(text)) out.push('contains an emoji');
  if (/\b[A-Z]{3,}\b/.test(text)) out.push('contains an ALL CAPS word');
  if (/([^\w\s])\1/.test(text)) out.push('repeats a special character');
  for (const w of BANNED) {
    const rx = new RegExp(w.startsWith('#') ? '#1' : `\\b${w}\\b`, 'i');
    if (rx.test(text)) out.push(`contains the banned word or phrase "${w}"`);
  }
  return out;
}

describe('Play listing text', () => {
  it('title is within 30 characters and follows the metadata rules', () => {
    const title = field('App name');
    assert.equal(title, 'Setnik: Concerts & Live Music');
    assert.deepEqual(problems(title, 30), []);
  });

  it('short description is within 80 characters and follows the metadata rules', () => {
    const short = field('Short description');
    assert.equal(short, "Hear the music, swipe through shows near you, save the ones you'll go to.");
    assert.deepEqual(problems(short, 80), []);
  });

  it('the checker catches bad text', () => {
    assert.ok(problems('Download now: the best app', 30).length >= 2);
    assert.ok(problems('Setnik 🎵', 30).length >= 1);
    assert.ok(problems('SETNIK live', 30).length >= 1);
    assert.ok(problems('Wow!! free', 80).length >= 2);
  });
});
