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
  loadPolicy,
  registerDirective,
  registerFor,
  type Register,
} from './lib/registers';
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

function buildSystemInstruction(register: Register): string {
  // The register directive goes LAST so it is the final thing the model reads
  // before the payload: the style guide is the constitution, this is the brief
  // for this particular chunk.
  return [
    readText(STYLE_GUIDE_PATH),
    '---',
    renderGlossary(),
    '---',
    registerDirective(register),
  ].join('\n\n');
}

interface Chunk {
  entries: FlatMessages;
  register: Register;
}

/**
 * Chunk WITHIN a register, never across one. A chunk carries a single register
 * directive, so mixing the two in one request would ask the model to write a
 * contract page and a tooltip in the same voice.
 */
function chunkEntries(flat: FlatMessages, register: Register): Chunk[] {
  const keys = Object.keys(flat);
  const chunks: Chunk[] = [];
  for (let index = 0; index < keys.length; index += CHUNK_SIZE) {
    const slice = keys.slice(index, index + CHUNK_SIZE);
    const entries: FlatMessages = {};
    for (const key of slice) entries[key] = flat[key];
    chunks.push({ entries, register });
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
  base: Omit<GeminiConfig, 'systemInstruction'>,
  chunk: Chunk,
  chunkIndex: number,
): Promise<{ result: FlatMessages; retries: number }> {
  const config: GeminiConfig = {
    ...base,
    systemInstruction: buildSystemInstruction(chunk.register),
  };
  // Send OPAQUE numeric ids, never the real dotted keys, so a weaker model can't
  // corrupt a key (e.g. Arabize "sqm" -> "sqم") and fail the whole chunk. Map back
  // to the real keys locally after the id set is verified.
  const realKeys = Object.keys(chunk.entries);
  const idToKey = new Map<string, string>();
  const payload: FlatMessages = {};
  realKeys.forEach((key, i) => {
    const id = String(i);
    idToKey.set(id, key);
    payload[id] = chunk.entries[key];
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
      `${lastDetail}. Offending keys: {${Object.keys(chunk.entries).join(', ')}}`,
  );
}

async function main(): Promise<void> {
  const { apiKey, model } = readGeminiEnv();
  const base = { apiKey, model };

  const enFlat = flatten(readCatalog(EN_PATH));
  const policy = loadPolicy();

  // I18N_REGISTER=eg|msa retranslates only that half. The other half keeps its
  // CURRENT Arabic through the seed below, so a register-scoped run cannot
  // churn copy that has already been reviewed.
  const only = process.env.I18N_REGISTER?.trim().toLowerCase();
  if (only && only !== 'eg' && only !== 'msa') {
    throw new Error(`I18N_REGISTER must be "eg" or "msa" (got "${only}")`);
  }

  // I18N_TOPUP=1 translates ONLY the keys a previous run did not get to.
  //
  // Without it a re-run re-sends every chunk: it would spend the quota the
  // stragglers need on chunks that already succeeded, and it would churn
  // translations that have already been read and approved. A key still carrying
  // its pre-run Arabic is one the model never produced output for, so that
  // comparison is the top-up set. (A short label the model happened to
  // reproduce verbatim is retried too — a negligible handful.)
  const topUp = process.env.I18N_TOPUP === '1';
  let pending: FlatMessages = enFlat;
  if (topUp) {
    if (!existsSync(AR_GENERATED_PATH)) {
      throw new Error(
        'I18N_TOPUP=1 needs a previous ar-EG.generated.json to top up. ' +
          'Run i18n:translate without it first.',
      );
    }
    const current = flatten(readCatalog(AR_PATH));
    const generated = flatten(readCatalog(AR_GENERATED_PATH));
    pending = {};
    for (const [key, value] of Object.entries(enFlat)) {
      if (generated[key] === undefined || generated[key] === current[key]) {
        pending[key] = value;
      }
    }
  }

  const buckets: Record<Register, FlatMessages> = { eg: {}, msa: {} };
  for (const [key, value] of Object.entries(pending)) {
    buckets[registerFor(key, policy)][key] = value;
  }

  const chunks: Chunk[] = [];
  for (const register of ['eg', 'msa'] as const) {
    if (only && only !== register) continue;
    chunks.push(...chunkEntries(buckets[register], register));
  }

  console.log(
    `i18n:translate — model=${model}${topUp ? ' TOP-UP' : ''}, ` +
      `keys=${Object.keys(pending).length}/${Object.keys(enFlat).length} ` +
      `(eg=${Object.keys(buckets.eg).length}, msa=${Object.keys(buckets.msa).length})` +
      `${only ? `, translating ${only.toUpperCase()} only` : ''}, ` +
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
        base,
        chunks[index],
        index,
      );
      Object.assign(translated, result);
      totalRetries += retries;
      console.log(
        `  chunk ${index + 1}/${chunks.length} [${chunks[index].register}] ok ` +
          `(${Object.keys(chunks[index].entries).length} keys` +
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
    const failedKeys = failed.flatMap((i) => Object.keys(chunks[i].entries));
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
