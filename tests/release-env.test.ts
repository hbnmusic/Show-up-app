import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts/check-release-env.sh');
const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
const URL = 'https://abcdefghijklmnopqrst.supabase.co';

function run(env: Record<string, string>, ...args: string[]) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? '' };
  const r = spawnSync('bash', [SCRIPT, ...args], { env: { ...clean, ...env } as NodeJS.ProcessEnv, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('release env self-check', () => {
  it('passes with both settings and never prints the key', () => {
    const key = jwt('anon');
    const r = run({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: key });
    assert.equal(r.code, 0);
    assert.match(r.out, /RESULT: OK/);
    assert.ok(!r.out.includes(key));
  });
  it('fails with a plain message when either setting is missing', () => {
    const none = run({});
    assert.equal(none.code, 1);
    assert.match(none.out, /SUPABASE_URL\s+MISSING/);
    assert.match(none.out, /SUPABASE_ANON_KEY\s+MISSING/);
    assert.match(none.out, /NOT READY/);
    const noKey = run({ SUPABASE_URL: URL });
    assert.equal(noKey.code, 1);
    assert.match(noKey.out, /SUPABASE_ANON_KEY\s+MISSING/);
    const noUrl = run({ SUPABASE_ANON_KEY: jwt('anon') });
    assert.equal(noUrl.code, 1);
    assert.match(noUrl.out, /SUPABASE_URL\s+MISSING/);
  });
  it('accepts the EXPO_PUBLIC_ names the workflow passes', () => {
    assert.equal(run({ EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') }).code, 0);
  });
  it('refuses a service_role or secret key and a non-https url', () => {
    assert.equal(run({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: jwt('service_role') }).code, 1);
    assert.equal(run({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: 'sb_secret_abc' }).code, 1);
    assert.equal(run({ SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co', SUPABASE_ANON_KEY: jwt('anon') }).code, 1);
    assert.equal(run({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: 'not-a-key' }).code, 1);
  });
  it('--signing fails when the signing secrets are absent', () => {
    const r = run({ SUPABASE_URL: URL, SUPABASE_ANON_KEY: jwt('anon') }, '--signing');
    assert.equal(r.code, 1);
    assert.match(r.out, /ANDROID_KEYSTORE_BASE64\s+MISSING/);
  });
  it('the release workflow runs the check before the build and the runners are pinned', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/android-release.yml'), 'utf8');
    const check = wf.indexOf('scripts/check-release-env.sh --signing');
    assert.ok(check > 0);
    assert.ok(check < wf.indexOf('npm ci'));
    assert.ok(check < wf.indexOf('gradlew bundleRelease'));
    for (const f of ['android-apk', 'android-release', 'deploy-functions', 'refresh-listings', 'venue-scan', 'venue-seed', 'purge-licensed', 'readiness-report', 'release-preflight']) {
      const text = readFileSync(join(ROOT, `.github/workflows/${f}.yml`), 'utf8');
      assert.ok(!/ubuntu-latest/.test(text), `${f} still uses ubuntu-latest`);
      assert.ok(!/actions\/(checkout|setup-node|setup-java|upload-artifact)@v[1-4]\b/.test(text), `${f} uses an old action version`);
    }
  });
});
