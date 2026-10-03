import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeApi, arg } from '../scripts/lib/api.ts';
import { matchLinks, licensedCandidate } from '../scripts/link-licensed.ts';
import { rowsToSeeds, sparql } from '../scripts/seed-venues.ts';
import type { Show } from '../src/lib/types.ts';

const jb = (over: Partial<Show> = {}): Show => ({
  id: 'jambase:123', startsAt: '2027-03-12T20:00:00-05:00', venue: { name: 'Parkside Hall', neighborhood: '', area: '', metro: 'nyc', city: 'Brooklyn, NY', addressVisibility: 'public' },
  acts: [{ name: 'The Examples', order: 0 }, { name: 'Opener Band', order: 1 }], genres: [], price: {}, status: 'scheduled',
  source: { provider: 'jambase', url: 'https://x.example', fetchedAt: '2026-10-01T00:00:00Z' }, updatedAt: '2026-10-01T00:00:00Z', ...over,
});
const own = { id: 'aaaa', metro: 'nyc', venue_id: null, venue_name: 'Parkside Hall', d: '2027-03-12', start_local: '20:00:00', headliner: 'The Examples', supports: [] };

describe('link-licensed', () => {
  it('links a matching show by id only', () => {
    const l = matchLinks([own], [{ show: jb(), metro: 'nyc' }]);
    assert.deepEqual(l, [{ showId: 'aaaa', source: 'jambase', externalId: 'jambase:123' }]);
  });
  it('does not link a different night, venue or metro', () => {
    assert.equal(matchLinks([own], [{ show: jb({ startsAt: '2027-03-13T20:00:00-05:00' }), metro: 'nyc' }]).length, 0);
    assert.equal(matchLinks([own], [{ show: jb({ venue: { ...jb().venue, name: 'Other Room' } }), metro: 'nyc' }]).length, 0);
    assert.equal(matchLinks([own], [{ show: jb(), metro: 'la' }]).length, 0);
  });
  it('handles a show with no acts', () => {
    assert.equal(licensedCandidate(jb({ acts: [] }), 'nyc'), null);
  });
});

describe('seed-venues', () => {
  it('queries by label, not by guessed ids', () => {
    assert.match(sparql(), /"music venue"@en/);
    assert.doesNotMatch(sparql(), /wd:Q\d+/);
  });
  it('assigns rows to a metro by distance and drops unlabeled or outside rows', () => {
    const row = (name: string, lng: number, lat: number) => ({ item: { value: 'http://www.wikidata.org/entity/Q1' }, itemLabel: { value: name }, coord: { value: `Point(${lng} ${lat})` }, website: { value: 'https://v.example' } });
    const s = rowsToSeeds([row('Brooklyn Room', -73.95, 40.7), row('Q99', -73.95, 40.7), row('Middle of nowhere', -100, 45)]);
    assert.equal(s.length, 1);
    assert.equal(s[0].metro, 'nyc');
    assert.equal(s[0].seededFrom, 'wikidata');
  });
});

describe('api helper', () => {
  it('requires url and token and sends the token as a header', async () => {
    assert.throws(() => makeApi({}));
    let seen: any;
    const api = makeApi({ FP_JOB_URL: 'https://f.example/fp-job', JOB_TOKEN: 't' }, (async (u: string, i: any) => { seen = { u, i }; return { ok: true, json: async () => ({ a: 1 }) }; }) as any);
    assert.deepEqual(await api('plan'), { a: 1 });
    assert.equal(seen.i.headers['x-job-token'], 't');
    assert.equal(JSON.parse(seen.i.body).action, 'plan');
  });
  it('parses args', () => assert.equal(arg('x', 'd', ['--x', '5']), '5'));
});
