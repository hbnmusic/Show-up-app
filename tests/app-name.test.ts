import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

import { APP_NAME } from '../src/lib/legal';

// The old name is assembled so this file does not contain it either.
const OLD = ['Pull' + ' Up', 'PULL' + ' UP', 'PullUp' + 'Bot', 'pull' + 'up', 'pull' + 'thru'];
const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'dist-functions', 'android', 'ios', 'coverage']);
const TEXT = /\.(ts|tsx|js|mjs|json|md|html|yml|yaml|sql|txt|css|patch)$/i;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (TEXT.test(name) || name.startsWith('.')) yield p;
  }
}

describe('app name', () => {
  it('is Come Thru and matches app.json', () => {
    assert.equal(APP_NAME, 'Come Thru');
    const cfg = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
    assert.equal(cfg.name, APP_NAME);
    assert.equal(cfg.scheme, 'comethru');
    assert.equal(cfg.android.package, 'com.hbnmusic.comethru');
    assert.equal(cfg.ios.bundleIdentifier, 'com.hbnmusic.comethru');
  });
  it('leaves no trace of the old name in code, docs or workflows (migration history excepted)', () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (rel === 'package-lock.json' || rel.startsWith('supabase/migrations/')) continue;
      const text = readFileSync(file, 'utf8');
      for (const w of OLD) if (text.includes(w)) hits.push(`${rel}: ${w}`);
    }
    assert.deepEqual(hits, []);
  });
  it('keeps the saved-data keys that start with the old name, so installed copies do not lose data', () => {
    const key = ['pull', 'up', 'going', 'v1'].join('-');
    assert.ok(readFileSync(join(ROOT, 'src/lib/going/store.ts'), 'utf8').includes(key));
  });
});
