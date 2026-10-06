import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

// Come Thru does not carry an age or venue-type field anywhere: not in the feeds, the app model or the flyer extraction schema.
const ROOT = join(__dirname, '..');
const DIRS = ['src', 'supabase/functions', 'scripts'];
const PATTERN = /age_policy|agePolicy/;
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(name)) yield p;
  }
}
describe('no age policy field', () => {
  it('is absent from app, server and script code and from the current schema', () => {
    const hits: string[] = [];
    for (const d of DIRS) for (const f of walk(join(ROOT, d))) if (PATTERN.test(readFileSync(f, 'utf8'))) hits.push(relative(ROOT, f));
    assert.deepEqual(hits, []);
    const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
    const lines = schema.split('\n').filter((l) => PATTERN.test(l) && !l.trim().startsWith('--'));
    // Only the clean-up statements of migration 023 may mention it.
    assert.ok(lines.every((l) => /drop column|age_policy\b.*like|agePolicy|from information_schema|'agePolicy'/.test(l)), lines.join('\n'));
  });
});
