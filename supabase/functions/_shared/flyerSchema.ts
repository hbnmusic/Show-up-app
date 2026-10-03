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
