import 'server-only';
// The client home's code-checked acts, the server's half: "I paid" on a
// payment request of the execution contract and on a design-fee instalment,
// signing the execution contract, and approving or rejecting a change order,
// each ONE token function (app_home_claim_request_by_token,
// app_home_claim_design_payment_by_token, app_home_contract_ack_by_token,
// app_home_variation_respond_by_token) run through ./code-act-run.ts. There is
// no other way to them from the app (OD2 strict): the claim functions those wrap
// are never called directly (no-unverified-claim.test.ts), and the contract
// acknowledgement and the change-order decision they wrap are called directly
// by /c's and /v's own actions only, for a proposal contract: a BOQ contract
// answers `moved` there (H6.3, H7.2; no-unverified-sign.test.ts,
// no-unverified-decision.test.ts).
import { sql } from 'drizzle-orm';
import { isUuid } from '@/lib/uuid';
import { provenCodeOf, runCodeAct, runProvenAct, type CodeProof } from './code-act-run';
import { VARIATION_DECISIONS, type CodeAnswer, type NamedCodeAnswer, type VariationDecision } from './code-answers';
import { readContractToSign } from './contract-signing';
import { signerNameOf } from './signer-name';

/**
 * "I paid" on ONE payment request of the home's execution contract, with a
 * code. The client sends no amount: the database claims what is still due and
 * tells the studio in the same transaction. A request id that is not a uuid
 * is `wrong_target` before any round trip, the answer the database gives an
 * id that is not the home's. The id is keyed lower case, as the code was.
 */
export async function claimRequestWithCodeByToken(
  rawToken: string,
  input: CodeProof & { requestId: unknown },
): Promise<CodeAnswer> {
  if (!isUuid(input.requestId)) return { ok: false, error: 'wrong_target' };
  const requestId = input.requestId.toLowerCase();
  return runCodeAct(rawToken, input, { purpose: 'claim_request', target: requestId }, (tokenHash, codeHash) =>
    sql`select public.app_home_claim_request_by_token(
      ${tokenHash}, ${requestId}::uuid, ${codeHash}, ${null}, ${null}, ${input.ip}, ${input.userAgent}
    ) as data`,
  );
}

/**
 * "I paid" on ONE design-fee instalment of the delivery, with a code. The
 * amount is the database's (what is still due on the instalment). The studio
 * is told by the caller, after an `ok` (lib/engagements/client-acts/notify.ts).
 */
export async function claimDesignPaymentWithCodeByToken(
  rawToken: string,
  input: CodeProof & { milestoneKind: unknown },
): Promise<CodeAnswer> {
  if (typeof input.milestoneKind !== 'string') return { ok: false, error: 'code_unknown' };
  const milestoneKind = input.milestoneKind;
  return runCodeAct(rawToken, input, { purpose: 'claim_design_payment', target: milestoneKind }, (tokenHash, codeHash) =>
    sql`select public.app_home_claim_design_payment_by_token(
      ${tokenHash}, ${milestoneKind}, ${codeHash}, ${null}, ${null}, ${input.ip}, ${input.userAgent}
    ) as data`,
  );
}

/**
 * Sign the home's execution contract `contractId`, with a code and the name
 * the client typed (./signer-name.ts). A contract id that is not a uuid is
 * `wrong_target` and no name is `name_required`, before any round trip. Then
 * the home's snapshot is read (./contract-signing.ts), and the act is sent only
 * for the contract still awaiting signature, with the server's own hash. Else:
 * signed already, `already`; not the home's contract, or no contract to sign
 * (a dead link, a delivery no longer at execution), `contract_inactive`; the
 * read failed, `busy` (nothing was sent). The database checks the code,
 * signs, uses the code up and tells the studio in one transaction.
 */
export async function signContractWithCodeByToken(
  rawToken: string,
  input: CodeProof & { contractId: unknown; name: unknown },
): Promise<NamedCodeAnswer> {
  if (!isUuid(input.contractId)) return { ok: false, error: 'wrong_target' };
  const contractId = input.contractId.toLowerCase();
  const name = signerNameOf(input.name);
  if (name === null) return { ok: false, error: 'name_required' };
  const proven = provenCodeOf(rawToken, input);
  if ('ok' in proven) return proven;
  const toSign = await readContractToSign(proven.token, contractId);
  if (toSign.kind === 'read_failed') return { ok: false, error: 'busy' };
  if (toSign.kind === 'not_this') return { ok: false, error: 'contract_inactive' };
  if (toSign.kind === 'signed') return { ok: true, already: true };
  const { pdfHash } = toSign;
  return runProvenAct(proven, { purpose: 'sign_contract', target: contractId }, (tokenHash, codeHash) =>
    sql`select public.app_home_contract_ack_by_token(
      ${tokenHash}, ${contractId}::uuid, ${codeHash}, ${name}, ${input.ip}, ${input.userAgent}, ${pdfHash}
    ) as data`,
  );
}

const decisionOf = (sent: unknown): VariationDecision | null => VARIATION_DECISIONS.find((known) => known === sent) ?? null;

/**
 * Approve or reject ONE change order of the home, with a code and the name the
 * client typed. An id that is not a uuid and a decision that is neither answer
 * `wrong_target`, no name `name_required`, and a code that is not six digits
 * `code_wrong` with no try counted, each before any round trip. The database
 * then checks the order is the home's (no try spent when it is not), checks
 * the code, decides, uses the code up and tells the studio in one transaction.
 * One code serves either decision: it is bound to the order, not the decision.
 */
export async function decideVariationWithCodeByToken(
  rawToken: string,
  input: CodeProof & { variationId: unknown; decision: unknown; name: unknown },
): Promise<NamedCodeAnswer> {
  const decision = decisionOf(input.decision);
  if (!isUuid(input.variationId) || decision === null) return { ok: false, error: 'wrong_target' };
  const variationId = input.variationId.toLowerCase();
  const name = signerNameOf(input.name);
  if (name === null) return { ok: false, error: 'name_required' };
  const proven = provenCodeOf(rawToken, input);
  if ('ok' in proven) return proven;
  return runProvenAct(proven, { purpose: 'decide_variation', target: variationId }, (tokenHash, codeHash) =>
    sql`select public.app_home_variation_respond_by_token(
      ${tokenHash}, ${variationId}::uuid, ${decision}, ${codeHash}, ${name}, ${input.ip}, ${input.userAgent}
    ) as data`,
  );
}
