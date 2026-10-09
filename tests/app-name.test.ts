import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { APP_NAME } from '../src/lib/legal';

/**
 * Guard: no old app name, old repo name, holding-company name or old identifier prefix in any tracked file.
 * Every forbidden word is assembled from parts so this file never contains one. A match is case-insensitive and
 * allows any separator (space, hyphen, underscore, none), so camelCase and kebab-case variants are caught too.
 */
const SEP = '[\\s_-]*';
const words = (...parts: string[]) => parts.join(SEP);
const FORBIDDEN: { label: string; rx: RegExp }[] = [
  { label: 'old app name 1', rx: new RegExp(words('pu' + 'll', 'u' + 'p'), 'i') },
  { label: 'old app name 2', rx: new RegExp(words('sh' + 'ow', 'u' + 'p'), 'i') },
  { label: 'old app name 3', rx: new RegExp(words('co' + 'me', 'th' + 'ru'), 'i') },
  { label: 'old app name 4', rx: new RegExp(words('ca' + 'tch', 'th' + 'e', 'se' + 't'), 'i') },
  { label: 'old app name 5', rx: new RegExp('gig' + 'mate', 'i') },
  { label: 'holding company / account', rx: new RegExp(words('hbn', 'mu' + 'sic'), 'i') },
];
/** Old identifier prefix (database functions). Only whole identifiers that start with it, so "input_x" style words are not hit. */
const PREFIX = new RegExp('(?<![A-Za-z0-9])' + 'p' + 'u_' + '(?=[a-z])');

/**
 * The listings feed address cannot change until the repository is moved. This one file is the ONLY allowed exception, and a hit is
 * accepted only when one of the 3 lines above carries the comment below.
 */
const MOVE_COMMENT = 'remove after repo move';
const HOSTING_ALLOWLIST = new Set(['src/lib/hosting.ts']);
/** Migrations are history: statements keep the old function prefix (migration 024 renames them). Comments are still checked. */
const rootDir = join(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: rootDir, encoding: 'utf8' }).split('\0').filter(Boolean);
const BINARY = /\.(png|jpe?g|webp|ttf|otf|ico|gif|keystore|jks)$/i;

function scan(): string[] {
  const hits: string[] = [];
  for (const rel of tracked) {
    if (BINARY.test(rel)) continue;
    const lines = readFileSync(join(rootDir, rel), 'utf8').split('\n');
    const isMigration = rel.startsWith('supabase/migrations/');
    const isRenameMigration = rel === 'supabase/migrations/024_rename_objects.sql';
    lines.forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      for (const f of FORBIDDEN) {
        if (!f.rx.test(line)) continue;
        const allowed = HOSTING_ALLOWLIST.has(rel) && lines.slice(Math.max(0, i - 3), i).some((l) => l.includes(MOVE_COMMENT));
        if (!allowed) hits.push(`${where}  [${f.label}]  ${line.trim().slice(0, 120)}`);
      }
      if (PREFIX.test(line)) {
        const comment = line.includes('--') ? line.slice(line.indexOf('--')) : '';
        const exempt = isRenameMigration || (isMigration && !PREFIX.test(comment));
        if (!exempt) hits.push(`${where}  [old identifier prefix]  ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return hits;
}

describe('app name', () => {
  it('is Setnik and matches app.json and package.json', () => {
    assert.equal(APP_NAME, 'Setnik');
    const cfg = JSON.parse(readFileSync(join(rootDir, 'app.json'), 'utf8')).expo;
    assert.equal(cfg.name, APP_NAME);
    assert.equal(cfg.slug, 'setnik');
    assert.equal(cfg.scheme, 'setnik');
    assert.equal(cfg.android.package, 'com.setnik.app');
    assert.equal(cfg.ios.bundleIdentifier, 'com.setnik.app');
    assert.equal(JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).name, 'setnik');
  });

  it('leaves no old name, old repo name, company name or old prefix in any tracked file (hosting allowlist excepted)', () => {
    const hits = scan();
    assert.deepEqual(hits, [], `\n${hits.join('\n')}\n`);
  });

  it('the hosting allowlist is only the one address file, each hit marked "remove after repo move"', () => {
    assert.deepEqual([...HOSTING_ALLOWLIST].sort(), ['src/lib/hosting.ts']);
    for (const rel of HOSTING_ALLOWLIST) assert.ok(readFileSync(join(rootDir, rel), 'utf8').includes(MOVE_COMMENT));
  });

  it('the checker itself catches variants', () => {
    const sample = ['Pu' + 'll-U' + 'p', 'sh' + 'ow_u' + 'p', 'Come' + 'Th' + 'ru', 'HBN' + ' Mu' + 'sic', 'gig' + 'Mate', 'ca' + 'tch the se' + 't'];
    for (const s of sample) assert.ok(FORBIDDEN.some((f) => f.rx.test(s)), s);
    assert.ok(PREFIX.test('p' + 'u_blocked') && !PREFIX.test('setnik_blocked'));
  });
});
