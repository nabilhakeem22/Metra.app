'use server';

import { LINK_BRAKE_REFUSAL, type NamedCodeAnswer, type VariationDecision } from '@/lib/client-home/code-answers';
import { decideVariationWithCodeByToken } from '@/lib/client-home/code-acts';
import { getOpenChangeOrderLines } from '@/lib/client-home/variations';
import type { PublicContractLine } from '@/lib/contracts/public-types';
import { answered, type PortalFailure } from '@/lib/share/portal-act-failure';
import { portalActAllowed, portalReadAllowed } from '@/lib/share/portal-rate-limit';
import { requestProvenance } from '@/lib/share/request-provenance';

// The Execution tab's change orders: approving or rejecting one with a one-time
// code (H7.1, the act), and its lines, read when the client asks (the page ships
// none of them). The decision spends the link's ACT budget, a read its READ
// budget (lib/share/portal-rate-limit.ts); past either, nothing is read or
// written and the answer is `too_many`. NOTHING THROWS TO THE CLIENT: each runs
// through `answered`, so a failure underneath is `uncertain` (the decision may
// still commit) or `generic` with its reference. The lines' own read is bounded
// and caught where it runs, and answers `load_failed`: no act is in doubt.

/** The order's lines; `gone`, uniformly, when the home no longer shows it for a decision; `load_failed` when the read failed or was slow. */
export type ChangeOrderLinesAnswer =
  | { ok: true; lines: PublicContractLine[] }
  | { ok: false; error: 'gone' }
  | { ok: false; error: 'load_failed' }
  | { ok: false; error: 'too_many' }
  | ({ ok: false } & PortalFailure);

const failed = (failure: PortalFailure) => ({ ok: false as const, ...failure });

/**
 * Public (no-session): the client approves or rejects the home's change order
 * `variationId`, with the name they typed and the code emailed to them for it
 * (./code-actions.ts). The database decides, uses the code up and tells the
 * studio in one transaction. Captures the client IP and user agent for the
 * decision's provenance.
 */
export async function decideVariationInHome(
  token: string,
  input: { variationId: string; decision: VariationDecision; name: string; code: string },
): Promise<NamedCodeAnswer> {
  return answered('decideVariationInHome', failed, async (): Promise<NamedCodeAnswer> => {
    if (!(await portalActAllowed(token))) return LINK_BRAKE_REFUSAL;
    return decideVariationWithCodeByToken(token, {
      variationId: input?.variationId,
      decision: input?.decision,
      name: input?.name,
      code: input?.code,
      ...(await requestProvenance()),
    });
  });
}

/** Public (no-session): the lines of one change order awaiting the client's decision. */
export async function loadChangeOrderLines(token: string, variationId: string): Promise<ChangeOrderLinesAnswer> {
  return answered('loadChangeOrderLines', failed, async (): Promise<ChangeOrderLinesAnswer> => {
    if (!(await portalReadAllowed(token))) return { ok: false, error: 'too_many' };
    const lines = await getOpenChangeOrderLines(token, variationId);
    if (lines === 'read_failed') return { ok: false, error: 'load_failed' };
    return lines ? { ok: true, lines } : { ok: false, error: 'gone' };
  });
}
