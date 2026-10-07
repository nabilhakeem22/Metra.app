import 'server-only';
// Public (no-session) client delivery portal: the WRITES. All are APPEND-ONLY
// ADVISORY signals: the SDF moves no state, writes no money ledger, and returns
// only a status code. A repeat is an idempotent SUCCESS (`code: 'already'`), which
// is the whole difference between a signal and a document response — a client
// double-tapping on a phone must not be shown an error.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode } from '@/lib/share/sdf-call';
import {
  mapSignalSdfCode,
  type SignalSdfResult,
  type TokenResponseError,
} from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { conceptLetter } from '../concept-letter';

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
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_delivery_respond_by_token(
    ${hash}, ${input.action}, ${input.note ?? null}, ${input.actorName ?? null},
    ${input.ip ?? null}, ${input.userAgent ?? null}
  ) as code`);
  return mapSignalSdfCode(code);
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
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_delivery_claim_payment_by_token(
    ${hash}, ${input.milestoneKind}, ${input.note ?? null},
    ${input.actorName ?? null}, ${input.ip ?? null}, ${input.userAgent ?? null}
  ) as code`);
  return mapSignalSdfCode(code);
}

/**
 * Session-less (Round B, B12): the client CHOOSES one concept option, by its RAW
 * share token. `position` is the letter the client SAW (1 = A to 4 = D); the SDF
 * accepts the choice only while that option still sits at that letter, and SAVES
 * it, so the studio reads the same letter the client tapped. A repeat maps to the
 * idempotent `already`; a letter that moved under the client (the studio hid or
 * released an option meanwhile) answers `wrong_state`. A non-uuid id or a
 * position that is not a letter never reaches the database: it is that same
 * `wrong_state`, so the answer is no oracle for which ids exist.
 */
export async function chooseConceptByToken(
  rawToken: string,
  input: {
    artifactId: string;
    position: number;
    note?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<DeliveryActionResult> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  if (!isUuid(input.artifactId) || conceptLetter(input.position) === null) {
    return mapSignalSdfCode('wrong_state');
  }
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_delivery_choose_concept_by_token(
    ${hash}, ${input.artifactId}::uuid, ${input.position}::int, ${input.note ?? null},
    null, ${input.ip ?? null}, ${input.userAgent ?? null}
  ) as code`);
  return mapSignalSdfCode(code);
}
