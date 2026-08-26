/**
 * i18n:translate — draft ar-EG translations with the Gemini API.
 *
 *   GEMINI_API_KEY=... [GEMINI_MODEL=gemini-2.5-pro] npm run i18n:translate
 *
 * The ONLY piece of the toolchain that calls an external API. It:
 *   1. loads en.json (source) + the style guide + glossary as the prompt,
 *   2. flattens en and chunks it (~70 keys/request),
 *   3. asks Gemini (JSON mode, temperature 0.2) to translate each chunk,
 *   4. asserts the returned key set equals the sent key set, retrying a chunk
 *      up to 3x with backoff on mismatch / parse / 429 / 5xx,
 *   5. reassembles in en's key order and writes ar-EG.generated.json.
 *
 * It NEVER overwrites ar-EG.json (that is `i18n:apply`, post-review) and never
 * prints the API key.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { flatten, unflatten, type FlatMessages } from './lib/flatten';
import {
  GeminiError,
  readGeminiEnv,
  translateChunk,
  type GeminiConfig,
} from './lib/gemini';
import {
  AR_GENERATED_PATH,
  AR_PATH,
  EN_PATH,
  GLOSSARY_PATH,
  STYLE_GUIDE_PATH,
  readCatalog,
  readText,
  writeCatalog,
} from './lib/paths';

// Load the root .env (where GEMINI_API_KEY lives, gitignored) before reading it,
// mirroring packages/db/src/env.ts. tsx does not auto-load .env.
const envDir = dirname(fileURLToPath(import.meta.url)); // scripts/i18n
for (const candidate of [
  resolve(envDir, '../../.env'), // repo root
  resolve(process.cwd(), '.env'),
]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const CHUNK_SIZE = 70;
const MAX_ATTEMPTS = 6;

type GlossaryTerm = { en: string; ar: string; gender?: string; notes?: string };

function renderGlossary(): string {
  const raw = JSON.parse(readText(GLOSSARY_PATH)) as { terms: GlossaryTerm[] };
  const lines = raw.terms.map((term) => {
    const gender = term.gender ? ` [${term.gender}]` : '';
    const notes = term.notes ? ` — ${term.notes}` : '';
    return `- ${term.en} = ${term.ar}${gender}${notes}`;
  });
  return `## Locked glossary (EN = AR [gender] — notes)\n\n${lines.join('\n')}`;
}

function buildSystemInstruction(): string {
  return `${readText(STYLE_GUIDE_PATH)}\n\n---\n\n${renderGlossary()}`;
}

function chunkEntries(flat: FlatMessages): FlatMessages[] {
  const keys = Object.keys(flat);
  const chunks: FlatMessages[] = [];
  for (let index = 0; index < keys.length; index += CHUNK_SIZE) {
    const slice = keys.slice(index, index + CHUNK_SIZE);
    const chunk: FlatMessages = {};
    for (const key of slice) chunk[key] = flat[key];
    chunks.push(chunk);
  }
  return chunks;
}

function keySetsMatch(sent: FlatMessages, received: Record<string, unknown>): {
  ok: boolean;
  detail: string;
} {
  const sentKeys = Object.keys(sent);
  const receivedKeys = new Set(Object.keys(received));
  const missing = sentKeys.filter((key) => !receivedKeys.has(key));
  const extra = [...receivedKeys].filter((key) => !(key in sent));
  const badType = sentKeys.filter(
    (key) => receivedKeys.has(key) && typeof received[key] !== 'string',
  );
  if (missing.length === 0 && extra.length === 0 && badType.length === 0) {
    return { ok: true, detail: '' };
  }
  const parts: string[] = [];
  if (missing.length) parts.push(`missing: {${missing.join(', ')}}`);
  if (extra.length) parts.push(`extra: {${extra.join(', ')}}`);
  if (badType.length) parts.push(`non-string: {${badType.join(', ')}}`);
  return { ok: false, detail: parts.join('; ') };
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function translateChunkWithRetry(
  config: GeminiConfig,
  chunk: FlatMessages,
  chunkIndex: number,
): Promise<{ result: FlatMessages; retries: number }> {
  // Send OPAQUE numeric ids, never the real dotted keys, so a weaker model can't
  // corrupt a key (e.g. Arabize "sqm" -> "sqم") and fail the whole chunk. Map back
  // to the real keys locally after the id set is verified.
  const realKeys = Object.keys(chunk);
  const idToKey = new Map<string, string>();
  const payload: FlatMessages = {};
  realKeys.forEach((key, i) => {
    const id = String(i);
    idToKey.set(id, key);
    payload[id] = chunk[key];
  });

  let lastDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const received = await translateChunk(config, payload);
      const check = keySetsMatch(payload, received);
      if (check.ok) {
        const result: FlatMessages = {};
        for (const [id, key] of idToKey) result[key] = String(received[id]);
        return { result, retries: attempt - 1 };
      }
      lastDetail = `id-set mismatch — ${check.detail}`;
    } catch (error) {
      if (error instanceof GeminiError && !error.retryable) {
        throw new Error(
          `Chunk ${chunkIndex + 1} failed (non-retryable): ${error.message}`,
        );
      }
      lastDetail = (error as Error).message;
    }
    if (attempt < MAX_ATTEMPTS) {
      // Exponential backoff capped at 30s, with jitter, to ride out 503 spikes.
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 30_000) + Math.floor(Math.random() * 400);
      console.log(
        `  chunk ${chunkIndex + 1}: attempt ${attempt} failed (${lastDetail}); ` +
          `retrying in ${backoffMs}ms`,
      );
      await delay(backoffMs);
    }
  }
  throw new Error(
    `Chunk ${chunkIndex + 1} failed after ${MAX_ATTEMPTS} attempts: ` +
      `${lastDetail}. Offending keys: {${Object.keys(chunk).join(', ')}}`,
  );
}

async function main(): Promise<void> {
  const { apiKey, model } = readGeminiEnv();
  const config: GeminiConfig = {
    apiKey,
    model,
    systemInstruction: buildSystemInstruction(),
  };

  const enFlat = flatten(readCatalog(EN_PATH));
  const chunks = chunkEntries(enFlat);
  console.log(
    `i18n:translate — model=${model}, keys=${Object.keys(enFlat).length}, ` +
      `chunks=${chunks.length} (~${CHUNK_SIZE}/chunk)`,
  );

  // Seed from a prior generated draft if one exists (so re-runs ACCUMULATE
  // coverage under free-tier quota), else from the current ar-EG.json. Either
  // way a key we cannot translate this run keeps a real Arabic value — a partial
  // run never blanks or loses a string.
  const seedPath = existsSync(AR_GENERATED_PATH) ? AR_GENERATED_PATH : AR_PATH;
  const seed = flatten(readCatalog(seedPath));
  const translated: FlatMessages = {};
  for (const key of Object.keys(enFlat)) translated[key] = seed[key] ?? '';

  let totalRetries = 0;
  const failed: number[] = [];

  async function runChunk(index: number): Promise<boolean> {
    try {
      const { result, retries } = await translateChunkWithRetry(
        config,
        chunks[index],
        index,
      );
      Object.assign(translated, result);
      totalRetries += retries;
      console.log(
        `  chunk ${index + 1}/${chunks.length} ok ` +
          `(${Object.keys(chunks[index]).length} keys` +
          `${retries ? `, ${retries} retr${retries === 1 ? 'y' : 'ies'}` : ''})`,
      );
      return true;
    } catch (error) {
      const head = (error as Error).message.split('. Offending')[0];
      console.log(`  chunk ${index + 1}/${chunks.length} FAILED — ${head}`);
      return false;
    }
  }

  // Pass 1: every chunk, continuing past a chunk that exhausts its retries.
  for (let index = 0; index < chunks.length; index++) {
    if (!(await runChunk(index))) failed.push(index);
  }

  // Sweep passes: retry only the stragglers, pausing between passes to let a
  // transient 503 congestion spike clear before giving up.
  const MAX_SWEEPS = 3;
  for (let sweep = 1; sweep <= MAX_SWEEPS && failed.length > 0; sweep++) {
    console.log(
      `\nSweep ${sweep}/${MAX_SWEEPS} — retrying ${failed.length} chunk(s) after a pause...`,
    );
    await delay(20_000);
    const still: number[] = [];
    for (const index of failed) {
      if (!(await runChunk(index))) still.push(index);
    }
    failed.splice(0, failed.length, ...still);
  }

  // Reassemble in en's key order and write (always — seeded, so complete).
  const ordered: FlatMessages = {};
  for (const key of Object.keys(enFlat)) ordered[key] = translated[key];
  writeCatalog(AR_GENERATED_PATH, unflatten(ordered));

  const done = chunks.length - failed.length;
  if (failed.length === 0) {
    console.log(
      `\nWrote ${AR_GENERATED_PATH}\n` +
        `Summary: ${chunks.length} chunks, ${Object.keys(ordered).length} keys, ` +
        `${totalRetries} retries. All chunks translated.\n` +
        `Next: npm run i18n:validate -- --file ` +
        `apps/web/src/messages/ar-EG.generated.json --strict, then i18n:review, ` +
        `then i18n:apply.`,
    );
  } else {
    const failedKeys = failed.flatMap((i) => Object.keys(chunks[i]));
    console.log(
      `\nWrote ${AR_GENERATED_PATH} (PARTIAL).\n` +
        `${done}/${chunks.length} chunks translated; ${failed.length} still failing ` +
        `after ${MAX_SWEEPS} sweeps — those ${failedKeys.length} keys keep their ` +
        `CURRENT ar-EG value. Re-run i18n:translate to top them up.\n` +
        `Failed keys: {${failedKeys.join(', ')}}`,
    );
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  console.error(`i18n:translate failed: ${(error as Error).message}`);
  process.exit(1);
});
