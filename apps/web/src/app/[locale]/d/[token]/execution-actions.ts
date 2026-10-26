'use server';

import { loggableFailure } from '@/lib/actions/loggable-failure';
import {
  claimExecutionRequestByToken,
  getDeliveryExecutionByToken,
  type ExecutionClaimResult,
} from '@/lib/engagements/public/execution';
import type { PortalExecution } from '@/lib/engagements/public/execution-types';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

// The client's execution card (Stage 2, D1a): the "I paid" on one payment
// request, and the card read again on demand. A NORMAL server action, not a
// keepalive fetch: the client stays on the page and waits for the answer, so
// nothing is fired and forgotten and no navigation can strand it (the Oct 18
// lesson is about a fire-and-forget call made just before navigating away).
//
// THE PER-LINK BRAKE (lib/share/portal-rate-limit.ts): the claim spends the
// link's ACT budget, the read its READ budget; past either, nothing is read or
// written and the answer is `too_many`. NOTHING THROWS TO THE CLIENT: both run
// through `answered`, so a failure underneath is `uncertain` (the claim may
// still commit) or `generic` with its reference.
//
// A claim that landed answers with the card as it is now, read once on this
// request, and the card shows it at once. The Execution tab then refreshes so
// its hero follows (./execution-tab.tsx): that re-render reads the home, one
// light SDF, and never the design snapshot (the A4 reliability R1 lesson).

/** A claim that never reached the database, or failed underneath. */
type UnansweredClaim = { ok: false; error: 'too_many' } | ({ ok: false } & PortalFailure);

/** A claim's answer; one that worked carries the card as it is now, when that read worked too. */
export type ExecutionClaimAnswer = (ExecutionClaimResult & { execution?: PortalExecution }) | UnansweredClaim;

/** The card read on demand; `gone` when the link no longer shows one (uniform, no oracle). */
export type ExecutionReadAnswer =
  | { ok: true; execution: PortalExecution }
  | { ok: false; error: 'gone' | 'too_many' }
  | ({ ok: false } & PortalFailure);

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/** The card after a write that worked; a read that fails leaves it out and the card reads itself. */
async function cardAfterClaim(token: string): Promise<PortalExecution | undefined> {
  try {
    return (await getDeliveryExecutionByToken(token)) ?? undefined;
  } catch (error) {
    console.error('execution card read after a claim failed', { failure: loggableFailure(error) });
    return undefined;
  }
}

/**
 * Public (no-session): the client says they paid ONE payment request. The
 * amount is the server's (what is still due); the studio confirms or dismisses
 * the claim. Captures the client IP and user agent for the claim's provenance.
 */
export async function claimExecutionRequest(token: string, requestId: string): Promise<ExecutionClaimAnswer> {
  return answered('claimExecutionRequest', failed, async () => {
    if (!(await portalActAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const result = await claimExecutionRequestByToken(token, { requestId, ...(await requestProvenance()) });
    if (!result.ok) return result;
    const execution = await cardAfterClaim(token);
    return execution ? { ...result, execution } : result;
  });
}

/** Public (no-session): the card read again, after a claim whose answer was lost. */
export async function loadDeliveryExecution(token: string): Promise<ExecutionReadAnswer> {
  return answered('loadDeliveryExecution', failed, async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const execution = await getDeliveryExecutionByToken(token);
    return execution ? { ok: true as const, execution } : { ok: false as const, error: 'gone' as const };
  });
}
