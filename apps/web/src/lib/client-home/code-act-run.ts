import 'server-only';
// How the client home's code-checked acts run (./code-acts.ts names them): the
// checks no round trip is spent on, then ONE token function that checks the
// code, takes the act and uses the code up in the same statement. The raw code
// is hashed here with the act it is for and never sent, logged or returned; the
// database checks it against the newest code of that act (H5 functional F1),
// so the browser holds no code id.
import type { SQL } from 'drizzle-orm';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { codeAnswerOf } from './code-act-answer';
import { typedCode, type CodeAnswer, type CodePurpose } from './code-answers';
import { logCodeActBusy } from './code-log';
import { clientCodeHash } from './codes';
import { busyOnLockRefusal } from './lock-refusal';

/** What every code-checked act is sent with: the client's code and where the act came from. */
export interface CodeProof {
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
export function provenCodeOf(rawToken: string, proof: CodeProof): ProvenCode | CodeAnswer {
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
export async function runProvenAct(
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
export async function runCodeAct(
  rawToken: string,
  proof: CodeProof,
  bound: { purpose: CodePurpose; target: string },
  act: (tokenHash: string, codeHash: string) => SQL,
): Promise<CodeAnswer> {
  const proven = provenCodeOf(rawToken, proof);
  return 'ok' in proven ? proven : runProvenAct(proven, bound, act);
}
