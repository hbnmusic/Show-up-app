/**
 * Private accuracy check for the flyer reader. Run by hand on your own machine; never in CI and never committed with data.
 *
 *   GEMINI_API_KEY=... npx tsx scripts/eval-flyers.ts private-eval [--model gemini-3.5-flash-lite] [--delay 7000]
 *
 * Folder layout (the folder is in .gitignore):
 *   name.txt            text recognised from a real flyer (copy it from the app or from any OCR tool)
 *   name.layout.txt     optional layout hints
 *   name.expected.json  { "metro": "nyc", "headliner": "...", "venue": "...", "date": "2026-10-16", "start": "20:00", "price_min": 15 }
 * Real flyer text goes to Gemini only when you run this yourself, with your own free-tier key and billing disabled.
 * Output: per-field accuracy, average tokens per request, and private-eval/results.json (also ignored).
 */
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import { METROS } from '../src/lib/metros';
import { todayIn } from '../supabase/functions/_shared/dates';
import { GeminiProvider } from '../supabase/functions/_shared/provider';
import { FLYER_SYSTEM, buildFlyerPrompt } from '../supabase/functions/_shared/prompt';
import { parseModelOutput } from '../supabase/functions/_shared/flyerSchema';
import { similarity } from '../supabase/functions/_shared/text';
import { validateFlyer } from '../supabase/functions/_shared/validate';
import { arg } from './lib/api';

type Expected = { metro?: string; headliner?: string; venue?: string; date?: string; start?: string; price_min?: number };

async function main() {
  const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'private-eval';
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Set GEMINI_API_KEY (a free-tier key from a Google project with billing never enabled).');
  const model = arg('model', 'gemini-3.5-flash-lite');
  const delay = Number(arg('delay', '7000'));
  const provider = new GeminiProvider(key, model);
  const metros = METROS.map((m) => ({ id: m.id, name: m.name, state: m.state, tz: m.tz }));
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.expected.json')).map((f) => f.replace(/\.expected\.json$/, ''));
  const tally = { n: 0, headliner: 0, venue: 0, date: 0, start: 0, price: 0, rejected: 0, tokensIn: 0, tokensOut: 0 };
  const results: unknown[] = [];
  for (const name of names) {
    const text = fs.readFileSync(path.join(dir, `${name}.txt`), 'utf8');
    const layoutFile = path.join(dir, `${name}.layout.txt`);
    const layout = fs.existsSync(layoutFile) ? fs.readFileSync(layoutFile, 'utf8') : undefined;
    const exp = JSON.parse(fs.readFileSync(path.join(dir, `${name}.expected.json`), 'utf8')) as Expected;
    const metro = metros.find((m) => m.id === exp.metro) ?? null;
    const now = new Date();
    const t = metro ? todayIn(metro.tz, now) : null;
    const today = t ? `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}` : now.toISOString().slice(0, 10);
    const r = await provider.extract({ system: FLYER_SYSTEM, prompt: buildFlyerPrompt({ text, layout, metro, today }) });
    const parsed = parseModelOutput(r.json, text);
    const v = validateFlyer(parsed, { metros, registry: [], hintMetro: exp.metro, now, fetchedAt: now.toISOString() });
    const c = v.candidates[0];
    tally.n++;
    tally.tokensIn += r.usage.inputTokens;
    tally.tokensOut += r.usage.outputTokens;
    if (!c) tally.rejected++;
    const ok = {
      headliner: !exp.headliner || (c && similarity(c.headliner, exp.headliner) >= 0.85),
      venue: !exp.venue || (c && similarity(c.venueName, exp.venue) >= 0.8),
      date: !exp.date || c?.localDate === exp.date,
      start: !exp.start || c?.startLocal === exp.start,
      price: exp.price_min == null || c?.price?.min === exp.price_min,
    };
    for (const k of ['headliner', 'venue', 'date', 'start', 'price'] as const) if (ok[k]) tally[k]++;
    results.push({ name, outcome: v.outcome, rejects: v.rejects.map((x) => x.reason), ok, usage: r.usage });
    console.log(`${name}: ${v.outcome} ${JSON.stringify(ok)}`);
    await new Promise((res) => setTimeout(res, delay));
  }
  const pct = (x: number) => (tally.n ? `${Math.round((100 * x) / tally.n)}%` : 'n/a');
  console.log(`\nFlyers: ${tally.n}. Headliner ${pct(tally.headliner)}, venue ${pct(tally.venue)}, date ${pct(tally.date)}, start ${pct(tally.start)}, price ${pct(tally.price)}, rejected ${pct(tally.rejected)}.`);
  if (tally.n) console.log(`Average tokens per request: ${Math.round(tally.tokensIn / tally.n)} in, ${Math.round(tally.tokensOut / tally.n)} out.`);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ model, tally, results }, null, 1));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
