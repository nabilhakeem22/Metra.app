/**
 * Minimal Gemini REST client for the translation step. Uses Node's built-in
 * `fetch` (Node >= 20) — no SDK dependency. This is the ONLY module that talks
 * to an external API. The API key is read from the environment and is never
 * logged, printed, or included in any thrown message.
 */
import type { FlatMessages } from './flatten';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';

export type GeminiConfig = {
  apiKey: string;
  model: string;
  systemInstruction: string;
};

/** Read model + key from the environment, erroring clearly (never printing the key). */
export function readGeminiEnv(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'GEMINI_API_KEY is not set. Export it in your shell (never commit it). ' +
        'This script is the only piece that calls Gemini.',
    );
  }
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-pro';
  return { apiKey, model };
}

/**
 * Translate a single chunk of `key -> englishValue` pairs. Returns the parsed
 * `key -> arabicValue` object exactly as the model returned it (the caller
 * asserts the key set). Throws a {@link GeminiError} on transport/HTTP/JSON
 * failure so the caller can decide whether to retry.
 */
export async function translateChunk(
  config: GeminiConfig,
  chunk: FlatMessages,
): Promise<Record<string, unknown>> {
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(
    config.model,
  )}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  const userInstruction =
    'Translate the VALUES of the following JSON object from English into ' +
    'Egyptian Arabic (ar-EG) per the system instruction. Return a JSON object ' +
    'with the SAME keys (unchanged) mapping each key to its Arabic string. ' +
    'Do not add, drop, rename, or reorder keys. Translate values only.\n\n' +
    JSON.stringify(chunk, null, 0);

  const body = {
    system_instruction: {
      parts: [{ text: config.systemInstruction }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userInstruction }],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.2,
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new GeminiError(
      `network error: ${(error as Error).message}`,
      true,
    );
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    // Read the body for diagnostics but scrub nothing sensitive is included —
    // the request URL (which carries the key) is never part of the body text.
    const text = await safeText(response);
    throw new GeminiError(
      `HTTP ${response.status}: ${text.slice(0, 300)}`,
      retryable,
    );
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = extractText(payload);
  if (text === null) {
    throw new GeminiError('response contained no text part', true);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new GeminiError(
      `model returned non-JSON: ${(error as Error).message}`,
      true,
    );
  }
}

/** Error carrying a `retryable` hint so the orchestrator can back off vs abort. */
export class GeminiError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'GeminiError';
    this.retryable = retryable;
  }
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: unknown;
};

function extractText(payload: GeminiResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  return text === '' ? null : text;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable body>';
  }
}
