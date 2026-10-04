/**
 * Language-model provider interface. Only Gemini is implemented. Calls happen only inside Edge Functions,
 * with the API key read from a function secret; the key never appears in the app or the repository.
 */
import { GEMINI_RESPONSE_SCHEMA } from './flyerSchema.ts';

export type LlmRequest = { system: string; prompt: string; maxOutputTokens?: number; schema?: unknown };
export type LlmUsage = { inputTokens: number; outputTokens: number };
/** What the model's reply looked like, for diagnosing unreadable answers (never contains personal data). */
export type LlmMeta = { finish?: string; thoughtTokens?: number; textLength: number; head: string };
export type LlmResult = { json: unknown; usage: LlmUsage; meta?: LlmMeta };

export class QuotaError extends Error {
  constructor(public retryAfterSec?: number) {
    super('quota');
  }
}
export class ProviderError extends Error {}

export interface LlmProvider {
  readonly name: string;
  extract(req: LlmRequest): Promise<LlmResult>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  constructor(
    private apiKey: string,
    private model: string,
    private doFetch: FetchLike = fetch as unknown as FetchLike,
    private schema: unknown = GEMINI_RESPONSE_SCHEMA,
  ) {}

  async extract(req: LlmRequest): Promise<LlmResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const res = await this.doFetch(url, {
      method: 'POST',
      // The key goes in a header, not the URL, so it does not end up in logs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: req.maxOutputTokens ?? 4096,
          responseMimeType: 'application/json',
          responseSchema: req.schema ?? this.schema,
        },
      }),
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      throw new QuotaError(Number.isFinite(ra) && ra > 0 ? ra : undefined);
    }
    if (!res.ok) throw new ProviderError(`gemini ${res.status}`);
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      json,
      usage: { inputTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0 },
      meta: { finish: body.candidates?.[0]?.finishReason, thoughtTokens: body.usageMetadata?.thoughtsTokenCount, textLength: text.length, head: text.slice(0, 120).replace(/\s+/g, ' ') },
    };
  }
}
