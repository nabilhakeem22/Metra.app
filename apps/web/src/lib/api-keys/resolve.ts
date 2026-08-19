import 'server-only';
import { createHash } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import type { OrgContext } from '@/lib/db/context';

/** Raw public API keys are `mtk_` + base64url(randomBytes(32)). */
export const API_KEY_PREFIX = 'mtk_';
/** Characters of the raw key stored (non-secret) for UI disambiguation. */
export const API_KEY_PREFIX_LEN = 12;
/**
 * STRICT shape of a raw key: `mtk_` + exactly 43 base64url chars (32 bytes,
 * unpadded) = 47 chars total. A pre-check against this rejects `mtk_<anything>`
 * with NO hash/DB call (R1/S2), so a garbage Bearer can't drive an unthrottled
 * resolver query against the shared DB. (An IP-keyed pre-auth throttle is a
 * tracked fast-follow — intentionally not added here.)
 */
export const API_KEY_RE = /^mtk_[A-Za-z0-9_-]{43}$/;
/** Throttle window: last_used_at is only stamped when older than this. */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/**
 * A resolved public-API caller. Carries NO stored role/visibility — `role` is the
 * key creator's LIVE membership role (resolved fresh each request). Cost/margin
 * visibility is derived at request time from canSeeMargin(role, hideMarginFromPm),
 * never stored on the key.
 */
export interface ApiPrincipal {
  orgId: string;
  userId: string;
  role: MemberRole;
  keyId: string;
  /** Every data access runs inside this org context (RLS + membership factor). */
  toOrgContext(): OrgContext;
}

export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

interface KeyRow {
  key_id: string;
  org_id: string;
  principal_user_id: string;
  role: MemberRole;
}

/**
 * Resolve a raw Bearer key to an ApiPrincipal, or null on ANY failure
 * (missing/malformed prefix, unknown/revoked/expired key, or a creator who is no
 * longer a member). The DB resolver (app_api_key_by_hash) is SECURITY DEFINER and
 * enforces liveness + the membership JOIN; this function never leaks WHY it failed.
 */
export async function resolveApiKey(
  rawKey: string | null | undefined,
): Promise<ApiPrincipal | null> {
  const raw = rawKey?.trim();
  // STRICT format gate BEFORE any hash/DB work — a malformed key never touches
  // the database (R1/S2).
  if (!raw || !API_KEY_RE.test(raw)) return null;

  const hash = sha256Hex(raw);
  const row = await withRequestDb((db) =>
    db.transaction(async (tx) => {
      // The resolver is SECURITY DEFINER and reads no GUCs, but EXECUTE is granted
      // only to metra_app — so drop into that role for the call.
      await tx.execute(sql`set local role metra_app`);
      const rows = (await tx.execute(
        sql`select public.app_api_key_by_hash(${hash}) as data`,
      )) as unknown as Array<{ data: KeyRow | null }>;
      return rows[0]?.data ?? null;
    }),
  );

  if (!row) return null;

  const orgId = row.org_id;
  const userId = row.principal_user_id;
  const role = row.role;
  const keyId = row.key_id;
  return {
    orgId,
    userId,
    role,
    keyId,
    toOrgContext: () => ({ orgId, userId, role }),
  };
}

/**
 * Best-effort, throttled stamp of last_used_at. Only writes when the stored value
 * is stale (older than the throttle window), so there is no DB write per request.
 * Never throws — the caller defers it past the response and ignores failures.
 */
export async function touchApiKey(rawKey: string): Promise<void> {
  const raw = rawKey.trim();
  if (!raw.startsWith(API_KEY_PREFIX)) return;
  const hash = sha256Hex(raw);
  const cutoff = new Date(Date.now() - LAST_USED_THROTTLE_MS);
  await withRequestDb((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local role metra_app`);
      await tx.execute(
        sql`select public.app_touch_api_key(${hash}, ${cutoff.toISOString()})`,
      );
    }),
  );
}
