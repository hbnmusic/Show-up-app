/**
 * What the language model is asked to return for a flyer, and the checks applied before anything is trusted.
 * The model sees recognised text (never the image). Every field must quote the text it came from; a field
 * whose quote cannot be found in the recognised text is dropped.
 */
import { appearsIn } from './text.ts';

export type Field = { value: string; source: string; confidence: number };

export const SINGLE_FIELDS = ['headliner', 'venue', 'address', 'city', 'date', 'weekday', 'doors', 'start', 'price', 'age_policy', 'ticket_url', 'genre'] as const;
export type SingleField = (typeof SINGLE_FIELDS)[number];

export type ParsedEvent = { fields: Partial<Record<SingleField, Field>>; supports: Field[] };
export type ParsedFlyer = { isFlyer: boolean; isSafe: boolean; events: ParsedEvent[] };

const fieldSchema = {
  type: 'OBJECT',
  nullable: true,
  properties: {
    value: { type: 'STRING' },
    source_text: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['value', 'source_text', 'confidence'],
};

/** Gemini `responseSchema` (OpenAPI subset). */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_flyer: { type: 'BOOLEAN' },
    is_safe: { type: 'BOOLEAN' },
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          ...Object.fromEntries(SINGLE_FIELDS.map((f) => [f, fieldSchema])),
          supports: { type: 'ARRAY', items: fieldSchema },
        },
        required: [...SINGLE_FIELDS, 'supports'],
      },
    },
  },
  required: ['is_flyer', 'is_safe', 'events'],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readField(v: unknown, ocrText: string, needsQuote = true): Field | null {
  if (!isObj(v)) return null;
  const value = typeof v.value === 'string' ? v.value.trim() : '';
  const source = typeof v.source_text === 'string' ? v.source_text.trim() : '';
  const c = typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0;
  if (!value) return null;
  // The quoted source must be in the recognised text; for a value the model could only have read, the value itself must be too.
  if (needsQuote && (!source || !appearsIn(source, ocrText))) return null;
  return { value, source, confidence: c };
}

/** Parses the model's JSON (string or object) against the recognised text. Unusable input yields a non-flyer result. */
export function parseModelOutput(raw: unknown, ocrText: string): ParsedFlyer {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { isFlyer: false, isSafe: true, events: [] };
    }
  }
  if (!isObj(data)) return { isFlyer: false, isSafe: true, events: [] };
  const isFlyer = data.is_flyer === true;
  const isSafe = data.is_safe !== false;
  const events: ParsedEvent[] = [];
  if (isFlyer && isSafe && Array.isArray(data.events)) {
    for (const e of data.events.slice(0, 40)) {
      if (!isObj(e)) continue;
      const fields: ParsedEvent['fields'] = {};
      for (const f of SINGLE_FIELDS) {
        const got = readField(e[f], ocrText);
        if (got) fields[f] = got;
      }
      const supports = (Array.isArray(e.supports) ? e.supports : [])
        .slice(0, 12)
        .map((s) => readField(s, ocrText))
        .filter((s): s is Field => s !== null);
      events.push({ fields, supports });
    }
  }
  return { isFlyer, isSafe, events };
}

// ---- venue pages: a compact schema (one evidence quote per event) so long calendars fit in the output limit -----------------

const S = { type: 'STRING', nullable: true };

/** Gemini `responseSchema` for venue event pages. Smaller than the flyer schema: values are plain strings and one quote backs each event. */
export const VENUE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_safe: { type: 'BOOLEAN' },
    events: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { headliner: S, supports: { type: 'ARRAY', items: { type: 'STRING' } }, date: S, weekday: S, start: S, doors: S, price: S, age_policy: S, ticket_url: S, genre: S, evidence: S },
        required: ['headliner', 'date', 'evidence'],
      },
    },
  },
  required: ['is_safe', 'events'],
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Parses the model's answer for a venue page. An event is kept only if its headliner and its evidence quote both appear in the page
 * text; start, doors and price are kept only if the printed value appears there too.
 */
export function parseVenueOutput(raw: unknown, pageText: string): ParsedFlyer {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { isFlyer: false, isSafe: true, events: [] };
    }
  }
  if (!isObj(data)) return { isFlyer: false, isSafe: true, events: [] };
  const isSafe = data.is_safe !== false;
  const events: ParsedEvent[] = [];
  if (isSafe && Array.isArray(data.events)) {
    for (const e of data.events.slice(0, 80)) {
      if (!isObj(e)) continue;
      const evidence = str(e.evidence);
      const headliner = str(e.headliner);
      if (!headliner || !evidence || !appearsIn(evidence, pageText) || !appearsIn(headliner, pageText)) continue;
      const mk = (v: unknown, check: boolean): Field | null => {
        const value = str(v);
        if (!value || (check && !appearsIn(value, pageText))) return null;
        return { value, source: evidence, confidence: 0.9 };
      };
      const fields: ParsedEvent['fields'] = { headliner: { value: headliner, source: evidence, confidence: 0.9 } };
      for (const [k, check] of [['date', false], ['weekday', false], ['start', true], ['doors', true], ['price', true], ['age_policy', false], ['ticket_url', true], ['genre', true]] as const) {
        const got = mk(e[k], check);
        if (got) fields[k] = got;
      }
      const supports = (Array.isArray(e.supports) ? e.supports : []).slice(0, 12).map((x) => mk(x, true)).filter((x): x is Field => x !== null);
      events.push({ fields, supports });
    }
  }
  return { isFlyer: events.length > 0, isSafe, events };
}
