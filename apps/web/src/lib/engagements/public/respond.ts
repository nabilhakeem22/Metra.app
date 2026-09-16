import 'server-only';
// Public (no-session) client delivery portal — the WRITES. Both are APPEND-ONLY
// ADVISORY signals: the SDF moves no state, writes no money ledger, and returns
// only a status code. A repeat is an idempotent SUCCESS (`code: 'already'`), which
// is the whole difference between a signal and a document response — a client
// double-tapping on a phone must not be shown an error.
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import {
  mapSignalSdfCode,
  type SignalSdfResult,
  type TokenResponseError,
} from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';

/** Coded outcomes the portal maps to a bilingual message. `already` is NOT an
 *  error — a repeat signal resolves to `{ ok: true, code: 'already' }`, which is
 *  what mapSignalSdfCode does and is the whole difference between a SIGNAL and a
 *  document response. An alias of the shared union, not a narrower one: a code a
 *  newer SDF starts returning must still be a value this portal can hold, and
 *  every message chain here ends in a fall-through. */
export type DeliveryActionError = TokenResponseError;

export type DeliveryActionResult = SignalSdfResult;

/**
 * Session-less: record a client's APPEND-ONLY ADVISORY signal (approve /
 * request-changes / acknowledge) against a delivery by its RAW share token.
 * Mirrors respondToProposalByToken — sha256-hash the token (never sent in the
 * clear, never logged), run the SECURITY DEFINER write SDF on the base connection,
 * and map its status code. The SDF moves no state, adds no guard, and returns only
 * a status (no cost/margin). A repeat of an already-recorded signal maps to a
 * SUCCESSFUL no-op (`code: 'already'`), so a double submit is idempotent.
 */
export async function recordDeliveryActionByToken(
  rawToken: string,
  input: {
    action: string;
    note?: string | null;
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<DeliveryActionResult> {
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_delivery_respond_by_token(
      ${hash}, ${input.action}, ${input.note ?? null}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  return mapSignalSdfCode(rows[0]?.code);
}

/**
 * Session-less (Client Delivery Portal Phase 3): record a client's "mark as paid"
 * against ONE milestone of a delivery by its RAW share token. Mirrors
 * recordDeliveryActionByToken — sha256-hash the token (never sent in the clear,
 * never logged), run the cost-blind SECURITY DEFINER write SDF on the base
 * connection, and map its status code. The SDF locks the claimed amount to the
 * milestone's full remaining due server-side (the client sends NO amount), moves no
 * state, writes no money ledger, and returns only a status. A repeat while a claim
 * is still pending maps to a SUCCESSFUL no-op (`code: 'already'`), so a double
 * submit is idempotent.
 */
export async function claimPaymentByToken(
  rawToken: string,
  input: {
    milestoneKind: string;
    note?: string | null;
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<DeliveryActionResult> {
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_delivery_claim_payment_by_token(
      ${hash}, ${input.milestoneKind}, ${input.note ?? null},
      ${input.actorName ?? null}, ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  return mapSignalSdfCode(rows[0]?.code);
}
