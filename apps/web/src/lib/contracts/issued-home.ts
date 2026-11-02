import 'server-only';
// What issueContract hands the studio for an issued BOQ contract: its client
// home, on the first tap or on a second one. Never a failed issue: the issue has
// committed, whatever becomes of its home.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import { clientHomeAnswer } from '@/lib/client-home/home-link';
import type { ClientHomeAnswer } from '@/lib/client-home/types';
import type { OrgContext } from '@/lib/db/context';
import { isIssuedExecutionContract } from './queries/lookups';

/**
 * The issued contract's client home. A home that failed says so in one log line
 * (reliability L5: the issue stands, its home does not); a throw is a failure
 * inside the answer.
 */
export async function issuedContractHome(ctx: OrgContext, contractId: string, origin: string): Promise<ClientHomeAnswer> {
  try {
    const answer = await clientHomeAnswer(ctx, contractId, origin);
    if (!answer.ok) console.error('issueContract: issued, client home failed', { code: answer.error });
    return answer;
  } catch (error) {
    return unexpectedFailure('issueContract: issued, client home failed', error);
  }
}

/**
 * The answer to Issue on a contract that is no draft (a lost answer, a stale
 * tab; reliability L4): an issued BOQ contract's home, as a first issue hands
 * it, else the refusal as it came. A read that failed leaves the refusal too:
 * nothing about the contract changed.
 */
export async function secondIssueAnswer(
  ctx: OrgContext,
  contractId: string,
  origin: string,
  refusal: ActionResult,
): Promise<ActionResult & { clientHome?: ClientHomeAnswer }> {
  try {
    if (!(await isIssuedExecutionContract(ctx, contractId))) return refusal;
  } catch (error) {
    console.error('issueContract: second tap read failed', loggableFailure(error));
    return refusal;
  }
  const clientHome = await issuedContractHome(ctx, contractId, origin);
  refreshApp();
  return { ok: true, clientHome };
}
