import 'server-only';
// Public (no-session) client delivery portal, Stage 2 DB step B: the execution
// card (what the client is asked to pay on the execution contract, what was
// received, how to pay) and the client's "I paid" on one payment request. The
// token SDFs run through lib/share/sdf-call, the one sanctioned
// base-connection surface: NO withOrgContext, NO org GUCs. The token IS the
// auth, and the raw token is hashed here and never logged.
import { sql } from 'drizzle-orm';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { shapeExecution } from './execution-shape';
import type { PortalExecution } from './execution-types';

/**
 * The execution card behind a RAW delivery token, or null: an unknown, revoked
 * or expired link, a delivery that is not at `execution`, one with no contract
 * the client can see, and a snapshot this build cannot shape all answer null.
 * A database failure throws; the caller decides what the page says about it.
 */
export async function getDeliveryExecutionByToken(rawToken: string): Promise<PortalExecution | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const snapshot = await readSdfJson<unknown>(
    sql`select public.app_delivery_execution_by_token(${hashShareToken(token)}) as data`,
  );
  return snapshot === null ? null : shapeExecution(snapshot);
}

/**
 * The card the delivery page opens with. A database failure is logged once
 * (redacted: never the token hash) and shows no card, so the rest of the page
 * still renders; the client's link is not called dead for it.
 */
export async function executionCardForPage(rawToken: string): Promise<PortalExecution | null> {
  try {
    return await getDeliveryExecutionByToken(rawToken);
  } catch (error) {
    console.error('delivery execution read failed', { error: loggableFailure(error) });
    return null;
  }
}

/**
 * What the client's "I paid" came to. `already` is an idempotent success, as
 * every advisory signal on this page (a repeat tap finds the claim it sent);
 * `busy` is the contract's flood ceiling (10 claims an hour), said in the
 * card's own words.
 */
export type ExecutionClaimResult =
  | { ok: true; already: boolean }
  | { ok: false; error: 'token_invalid' | 'token_expired' | 'not_active' | 'wrong_state' | 'busy' };

/** The SDF's code as the portal reads it; a code nobody sent is a dead link, as on every surface. */
function claimResultOf(code: string | undefined): ExecutionClaimResult {
  switch (code) {
    case 'ok':
      return { ok: true, already: false };
    case 'already':
      return { ok: true, already: true };
    case 'expired':
      return { ok: false, error: 'token_expired' };
    case 'not_active':
    case 'wrong_state':
    case 'busy':
      return { ok: false, error: code };
    default:
      return { ok: false, error: 'token_invalid' };
  }
}

/**
 * The client's "I paid" on ONE payment request (AC33). The client sends no
 * amount: the SDF claims what is still due, under the request's row lock, and
 * tells the studio in the same transaction. A request id that is not a uuid is
 * `wrong_state` before any round trip, the answer the SDF gives a forged one.
 * `write`: a deadline on Cloudflare is "uncertain", never "nothing saved".
 */
export async function claimExecutionRequestByToken(
  rawToken: string,
  input: { requestId: unknown; ip: string | null; userAgent: string | null },
): Promise<ExecutionClaimResult> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  if (!isUuid(input.requestId)) return { ok: false, error: 'wrong_state' };
  const code = await readSdfCode(
    sql`select public.app_delivery_claim_request_by_token(
      ${hashShareToken(token)}, ${input.requestId}::uuid, ${null}, ${null}, ${input.ip}, ${input.userAgent}
    ) as code`,
    { write: true },
  );
  return claimResultOf(code);
}
