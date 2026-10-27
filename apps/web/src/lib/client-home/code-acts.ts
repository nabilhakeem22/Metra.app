import 'server-only';
// The client home's code-checked acts, the server's half: "I paid" on a
// payment request of the execution contract and on a design-fee instalment,
// each ONE token function (app_home_claim_request_by_token,
// app_home_claim_design_payment_by_token) that checks the code, takes the act
// and uses the code up in the same statement. There is no other way to them
// from the app (OD2 strict): the claim functions those wrap are never called
// directly (no-unverified-claim.test.ts). The raw code is hashed here with the
// act it is for and never sent, logged or returned; the database checks it
// against the newest code of that act (H5 functional F1), so the browser
// holds no code id.
import { sql, type SQL } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { codeAnswerOf } from './code-act-answer';
import { typedCode, type CodeAnswer, type CodePurpose } from './code-answers';
import { clientCodeHash } from './codes';
import { busyOnLockRefusal } from './lock-refusal';

/** What every code-checked act is sent with: the client's code and where the act came from. */
interface CodeProof {
  code: unknown;
  ip: string | null;
  userAgent: string | null;
}

/**
 * The checks no round trip is spent on, then the act. A blank token is a dead
 * link; a code that is not six digits is `code_wrong` with no try counted.
 * `act` builds the call from the token's hash and the code's (bound to
 * `purpose` and `target`, the act's subject as the database keys it). A lock
 * refusal from the database rolled the act back whole: `busy`, the code
 * unused (H5 reliability R4).
 */
async function runCodeAct(
  rawToken: string,
  proof: CodeProof,
  bound: { purpose: CodePurpose; target: string },
  act: (tokenHash: string, codeHash: string) => SQL,
): Promise<CodeAnswer> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const code = typedCode(proof.code);
  if (code === null) return { ok: false, error: 'code_wrong' };
  const query = act(hashShareToken(token), clientCodeHash(bound.purpose, bound.target, code));
  return busyOnLockRefusal('codeAct', { ok: false, error: 'busy' } as const, async () =>
    codeAnswerOf(await readSdfJson<unknown>(query, { write: true })),
  );
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
