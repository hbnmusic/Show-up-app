import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { ALL_GENRES, GENRE_GROUPS, groupGenres } from '../src/lib/types';

describe('genre buckets', () => {
  it('puts every genre in exactly one bucket', () => {
    const all = GENRE_GROUPS.flatMap((g) => g.genres);
    assert.equal(new Set(all).size, all.length);
    assert.equal(ALL_GENRES.length, 27);
  });

  it('shows only the wanted genres and drops empty buckets', () => {
    const g = groupGenres((x) => x === 'Metal' || x === 'Reggae');
    assert.deepEqual(g.map((x) => x.title), ['Metal & Heavy', 'Latin & Reggae']);
  });

  it('matches the genre list the server accepts', () => {
    const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
    const body = sql.slice(sql.indexOf('function public.pu_allowed_genres'));
    const list = body.slice(body.indexOf('array['), body.indexOf(']::text[]'));
    const server = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(server, [...ALL_GENRES].sort());
  });
});
