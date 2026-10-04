import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

// The retired seller's name is assembled so this file does not contain it either.
const WORD = 'ticket' + 'master';
const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'dist-functions', 'android', 'ios', 'coverage']);
const ALLOWED = (rel: string) => rel === 'CHANGELOG.md' || rel.startsWith('supabase/migrations/');
const TEXT = /\.(ts|tsx|js|mjs|json|md|html|yml|yaml|sql|txt|css|env|example)$/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (TEXT.test(name) || name.startsWith('.')) yield p;
  }
}

describe('repo hygiene', () => {
  it('names the retired seller only in migration history and the changelog', () => {
    const hits: string[] = [];
    for (const f of walk(ROOT)) {
      const rel = relative(ROOT, f).split('\\').join('/');
      if (ALLOWED(rel)) continue;
      if (readFileSync(f, 'utf8').toLowerCase().includes(WORD)) hits.push(rel);
    }
    assert.deepEqual(hits, []);
  });

  it('has no secret reference for it either', () => {
    const hits: string[] = [];
    for (const f of walk(join(ROOT, '.github'))) if (readFileSync(f, 'utf8').toUpperCase().includes(WORD.toUpperCase() + '_API')) hits.push(f);
    assert.deepEqual(hits, []);
  });
});
