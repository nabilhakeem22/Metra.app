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
  const rows = (await withRequestDb((db) => db.execute(query))) as unknown as Array<{
    code: string;
  }>;
  return rows[0]?.code;
}
