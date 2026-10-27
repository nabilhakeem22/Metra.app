import 'server-only';
// The client home's code-checked acts, the server's half: "I paid" on a
// payment request of the execution contract and on a design-fee instalment,
// and signing the execution contract, each ONE token function
// (app_home_claim_request_by_token, app_home_claim_design_payment_by_token,
// app_home_contract_ack_by_token) that checks the code, takes the act and uses
// the code up in the same statement. There is no other way to them from the
// app (OD2 strict): the claim functions those wrap are never called directly
// (no-unverified-claim.test.ts), and the contract acknowledgement the signing
// wraps is called directly by /c's own page only, until plan H6.3 moves /c
// onto the code too (no-unverified-sign.test.ts). The raw code is hashed here
// with the act it is for and never sent, logged or returned; the database
// checks it against the newest code of that act (H5 functional F1), so the
// browser holds no code id.
import { sql, type SQL } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { codeAnswerOf } from './code-act-answer';
import { typedCode, type CodeAnswer, type CodePurpose, type SignContractAnswer } from './code-answers';
import { logCodeActBusy } from './code-log';
import { clientCodeHash } from './codes';
import { readContractToSign } from './contract-signing';
import { busyOnLockRefusal } from './lock-refusal';
import { signerNameOf } from './signer-name';

/** What every code-checked act is sent with: the client's code and where the act came from. */
interface CodeProof {
  code: unknown;
  ip: string | null;
  userAgent: string | null;
}

/** A link and a code that passed the checks no round trip is spent on. */
interface ProvenCode {
  token: string;
  code: string;
}

/** A blank token is a dead link; a code that is not six digits is `code_wrong` with no try counted. */
function provenCodeOf(rawToken: string, proof: CodeProof): ProvenCode | CodeAnswer {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const code = typedCode(proof.code);
  if (code === null) return { ok: false, error: 'code_wrong' };
  return { token, code };
}

/**
 * The act. `act` builds the call from the token's hash and the code's (bound
 * to `purpose` and `target`, the act's subject as the database keys it). A
 * lock refusal from the database rolled the act back whole: `busy`, the code
 * unused (H5 reliability R4). The wrapper's own `busy` is logged too (H6.2 R-L6).
 */
async function runProvenAct(
  proven: ProvenCode,
  bound: { purpose: CodePurpose; target: string },
  act: (tokenHash: string, codeHash: string) => SQL,
): Promise<CodeAnswer> {
  const query = act(hashShareToken(proven.token), clientCodeHash(bound.purpose, bound.target, proven.code));
  return busyOnLockRefusal('codeAct', { ok: false, error: 'busy' } as const, async () => {
    const answer = codeAnswerOf(await readSdfJson<unknown>(query, { write: true }));
    if (!answer.ok && answer.error === 'busy') logCodeActBusy(bound.purpose);
    return answer;
  });
}

/** The checks no round trip is spent on, then the act. */
async function runCodeAct(
  rawToken: string,
  proof: CodeProof,
  bound: { purpose: CodePurpose; target: string },
  act: (tokenHash: string, codeHash: string) => SQL,
): Promise<CodeAnswer> {
  const proven = provenCodeOf(rawToken, proof);
  return 'ok' in proven ? proven : runProvenAct(proven, bound, act);
}

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
): Promise<SignContractAnswer> {
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
