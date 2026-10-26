'use server';

import type { CodeAnswer } from '@/lib/client-home/code-answers';
import { claimRequestWithCodeByToken } from '@/lib/client-home/code-acts';
import { getDeliveryExecutionByToken } from '@/lib/engagements/public/execution';
import type { PortalExecution } from '@/lib/engagements/public/execution-types';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

// The client's payments on the Execution tab (Stage 2, D1a): the "I paid" on
// one payment request, WITH A ONE-TIME CODE (OD2 strict: there is no claim
// without one), and the payments read again on demand. A NORMAL server
// action, not a keepalive fetch: the client stays on the page and waits for
// the answer.
//
// ONE TOKEN FUNCTION PER ACT (the Workers CPU budget): the claim is
// app_home_claim_request_by_token and nothing else. The Execution tab then
// refreshes (./execution-tab.tsx), which reads the home, one light SDF with
// the payments embedded, and never the design snapshot.
//
// THE PER-LINK BRAKE (lib/share/portal-rate-limit.ts): the claim spends the
// link's ACT budget, the read its READ budget; past either, nothing is read or
// written and the answer is `too_many`. NOTHING THROWS TO THE CLIENT: both run
// through `answered`, so a failure underneath is `uncertain` (the claim may
// still commit) or `generic` with its reference.

/** The payments read on demand; `gone` when the link no longer shows them (uniform, no oracle). */
export type ExecutionReadAnswer =
  | { ok: true; execution: PortalExecution }
  | { ok: false; error: 'gone' | 'too_many' }
  | ({ ok: false } & PortalFailure);

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/**
 * Public (no-session): the client says they paid ONE payment request, with the
 * code emailed to them for it (./code-actions.ts). The amount is the
 * database's (what is still due); the studio is told in the same transaction
 * and confirms or dismisses the claim. Captures the client IP and user agent
 * for the claim's provenance.
 */
export async function claimRequestInHome(
  token: string,
  input: { requestId: string; challengeId: string; code: string },
): Promise<CodeAnswer> {
  return answered('claimRequestInHome', failed, async (): Promise<CodeAnswer> => {
    if (!(await portalActAllowed(token))) return { ok: false, error: 'too_many' };
    return claimRequestWithCodeByToken(token, {
      requestId: input?.requestId,
      challengeId: input?.challengeId,
      code: input?.code,
      ...(await requestProvenance()),
    });
  });
}

/** Public (no-session): the payments read again, after a claim whose answer was lost. */
export async function loadDeliveryExecution(token: string): Promise<ExecutionReadAnswer> {
  return answered('loadDeliveryExecution', failed, async () => {
    if (!(await portalReadAllowed(token))) return { ok: false as const, error: 'too_many' as const };
    const execution = await getDeliveryExecutionByToken(token);
    return execution ? { ok: true as const, execution } : { ok: false as const, error: 'gone' as const };
  });
}
