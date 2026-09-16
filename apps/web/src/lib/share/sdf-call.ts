import 'server-only';
import type { SQL } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';

/**
 * The ONE sanctioned base-connection surface for token SECURITY DEFINER calls.
 *
 * Nine files each opened the raw connection themselves and each was individually
 * allowlisted in `eslint-rules/no-bare-tenant-db.mjs`. That is nine places where
 * a future non-token query could be added under an exemption granted for a
 * different reason. The exemption now belongs to this file, which does exactly
 * two things and has no other reason to exist.
 *
 * NO `withOrgContext`, NO org GUCs — deliberately. These functions are SECURITY
 * DEFINER and take a token HASH as their lookup key: the token IS the auth, and
 * the SDF itself omits every cost/margin column. Setting an org GUC here would be
 * meaningless (there is no session to derive an org from) and misleading.
 *
 * Nothing in this file interpolates a value into SQL. Callers pass a built `SQL`
 * object whose parameters drizzle binds; there is no string concatenation path.
 */

/**
 * A raw share token, or `null` when it is absent or blank.
 *
 * Refuse BEFORE any round-trip: an empty token cannot match a hash, so hashing
 * it and asking the database is a wasted connection on a path that is reachable
 * by anyone with the URL. Every portal wrote `!raw || !raw.trim()` by hand.
 */
export function normalizeRawToken(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** A token SDF call and nothing else: `select public.app_<name>(`, then arguments. */
const TOKEN_SDF_CALL = /^\s*select\s+public\.app_[a-z0-9_]+\s*\(/i;

/**
 * The literal text a built `SQL` opens with.
 *
 * Drizzle splits a template into chunks: the literal segments are `StringChunk`s
 * carrying `value: string[]`, and every interpolated value is a separate chunk it
 * binds as a parameter. So the FIRST chunk is the statement's opening text with no
 * caller data in it — safe to read, and safe to put in an error message.
 */
function leadingSqlText(query: SQL): string {
  const [first] = (query as unknown as { queryChunks?: unknown[] }).queryChunks ?? [];
  const value = (first as { value?: unknown } | undefined)?.value;
  if (Array.isArray(value)) return value.join('');
  return typeof value === 'string' ? value : '';
}

/**
 * Refuse anything that is not a token SDF call, before it reaches the socket.
 *
 * "These runners only ever call token SECURITY DEFINER functions" was a comment,
 * and a comment is not a boundary: the eslint fence stops a NEW file importing
 * this module, and this stops an ALLOWLISTED one handing it an ordinary query.
 * A refusal here is a programming error, not a user input — every real caller is
 * a `sql` template literal in this repository — so it throws rather than
 * returning, and it throws BEFORE the connection is borrowed.
 */
function assertTokenSdf(query: SQL): void {
  const leading = leadingSqlText(query);
  if (TOKEN_SDF_CALL.test(leading)) return;
  throw new Error(
    `sdf-call runs token SECURITY DEFINER functions only; refused: ${leading.trim().slice(0, 80)}`,
  );
}

/**
 * Run a token SDF that returns ONE json column aliased `data`, e.g.
 * ``sql`select public.app_proposal_by_token(${hash}) as data` ``.
 *
 * `null` means "no document": an unknown hash, an expired link, or a function
 * that returned SQL NULL. The portal renders its invalid-token page from that
 * one value, which is why no distinction is made here — telling a visitor WHICH
 * of those it was is an oracle.
 */
export async function readSdfJson<TPayload>(query: SQL): Promise<TPayload | null> {
  assertTokenSdf(query);
  const rows = (await withRequestDb((db) => db.execute(query))) as unknown as Array<{
    data: TPayload | null;
  }>;
  return rows[0]?.data ?? null;
}

/**
 * Run a token SDF that returns ONE text column aliased `code`, e.g.
 * ``sql`select public.app_proposal_respond_by_token(${hash}, ...) as code` ``.
 *
 * `undefined` when the function returned no row at all; the code mappers in
 * ./sdf-result.ts read that as `token_invalid`, same as any unrecognised code.
 */
export async function readSdfCode(query: SQL): Promise<string | undefined> {
  assertTokenSdf(query);
  const rows = (await withRequestDb((db) => db.execute(query))) as unknown as Array<{
    code: string;
  }>;
  return rows[0]?.code;
}
