import 'server-only';
// The one-time codes of the client home, the server's half: making a code,
// asking the database for it (app_home_code_issue_by_token, the ONE token
// function a code request runs), and telling it a code's email never left
// (app_home_code_unsent_by_token). The raw code exists only here, in the email
// and in what the client types: the database is passed
// sha256(purpose:target:code), and nothing in this file logs or returns the
// code to the browser.
import { createHash, randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { formatDocNumber, type DocPrefix } from '@/lib/format/doc-number';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { ISSUE_LIMITS, type CodeLimit, type CodePurpose } from './code-answers';
import { busyOnLockRefusal } from './lock-refusal';

/** A fresh code and its hash. `codeHash` is all the database ever sees. */
export interface NewClientCode {
  code: string;
  codeHash: string;
}

/**
 * sha256 of `purpose:target:code`, lower-case hex: the code bound to the act
 * it is for. The act sends the same three, so the database checks the code
 * by its target and never by an id the browser holds (H5 functional F1).
 */
export function clientCodeHash(purpose: CodePurpose, target: string, code: string): string {
  return createHash('sha256').update(`${purpose}:${target}:${code}`).digest('hex');
}

/** Six digits from the CSPRNG, zero-padded, hashed for the act they are for. */
export function newClientCode(purpose: CodePurpose, target: string): NewClientCode {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return { code, codeHash: clientCodeHash(purpose, target, code) };
}

/** The studio and the document an issued code's email names, as the database read them. */
export interface CodeEmailFacts {
  /** The client's address on file, for the send only: it never leaves the server. */
  email: string;
  studio: { nameAr: string | null; nameEn: string | null };
  documentNumber: string;
}

/** What the issue function answered. `challengeId` is the code's row, for the server only. */
export type CodeIssueResult =
  | ({ status: 'ok'; challengeId: string; hint: string; resendAfterSeconds: number; platformDayHalfCrossed: boolean } & CodeEmailFacts)
  | { status: 'too_many'; retryAfterSeconds: number; limit: CodeLimit }
  | { status: 'no_channel' | 'not_available' | 'busy' | 'invalid' | 'expired' };

const REFUSALS = new Set(['no_channel', 'not_available', 'busy', 'invalid', 'expired']);
const DOC_PREFIXES = new Set<DocPrefix>(['C', 'VO', 'PR', 'DE']);

interface IssuePayload {
  status?: unknown;
  challenge_id?: unknown;
  email?: unknown;
  hint?: unknown;
  resend_after_seconds?: unknown;
  retry_after_seconds?: unknown;
  limit?: unknown;
  platform_day_half_crossed?: unknown;
  studio?: { name_ar?: unknown; name_en?: unknown } | null;
  document?: { prefix?: unknown; number?: unknown; year?: unknown } | null;
}

const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null);

/** The document's display number, or null when the answer does not carry a well-formed one. */
function documentNumberOf(document: IssuePayload['document']): string | null {
  const prefix = document?.prefix;
  const { number, year } = document ?? {};
  if (typeof prefix !== 'string' || !DOC_PREFIXES.has(prefix as DocPrefix)) return null;
  if (!Number.isInteger(number) || !Number.isInteger(year)) return null;
  return formatDocNumber(prefix as DocPrefix, number as number, year as number);
}

/** A too_many answer, read strictly: its wait and the limit the database named; null for any other answer. */
function tooManyOf(answer: IssuePayload): CodeIssueResult | null {
  const limit = ISSUE_LIMITS.find((known) => known === answer.limit);
  if (answer.status !== 'too_many' || !Number.isInteger(answer.retry_after_seconds) || !limit) return null;
  return { status: 'too_many', retryAfterSeconds: answer.retry_after_seconds as number, limit };
}

/**
 * The issue function's answer, read strictly. An answer this build cannot read
 * is the server's own defect and throws (developer-only): the action answers
 * it as a failure with a reference, never as a sent code.
 */
export function issueResultOf(payload: unknown): CodeIssueResult {
  const answer = (payload ?? {}) as IssuePayload;
  const tooMany = tooManyOf(answer);
  if (tooMany) return tooMany;
  if (typeof answer.status === 'string' && REFUSALS.has(answer.status)) {
    return { status: answer.status as 'no_channel' | 'not_available' | 'busy' | 'invalid' | 'expired' };
  }
  const documentNumber = documentNumberOf(answer.document);
  if (
    answer.status === 'ok' &&
    isUuid(answer.challenge_id) &&
    typeof answer.email === 'string' &&
    typeof answer.hint === 'string' &&
    Number.isInteger(answer.resend_after_seconds) &&
    typeof answer.platform_day_half_crossed === 'boolean' &&
    documentNumber !== null
  ) {
    return {
      status: 'ok',
      challengeId: answer.challenge_id,
      email: answer.email,
      hint: answer.hint,
      resendAfterSeconds: answer.resend_after_seconds as number,
      platformDayHalfCrossed: answer.platform_day_half_crossed,
      studio: { nameAr: textOrNull(answer.studio?.name_ar), nameEn: textOrNull(answer.studio?.name_en) },
      documentNumber,
    };
  }
  // developer-only: the status is the only field named, never the address.
  throw new Error(`app_home_code_issue_by_token answered a shape this build cannot read (status ${String(answer.status)})`);
}

/**
 * Ask the database for a code for ONE act on the home behind a RAW delivery
 * token (hashed here, never logged; a blank one is `invalid` with no round
 * trip). The database checks the act can be taken now and every limit, and
 * writes the code's row, in one statement; nothing is written unless it
 * answers `ok`. A lock wait that gave up, or a deadlock that chose this
 * request, rolled the statement back: `busy` (H5 reliability R4). A WRITE: a
 * deadline on Cloudflare is "may have applied", never "nothing written".
 */
export async function issueClientCodeByToken(
  rawToken: string,
  input: { codeHash: string; purpose: CodePurpose; target: string; ip: string | null; userAgent: string | null },
): Promise<CodeIssueResult> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { status: 'invalid' };
  return busyOnLockRefusal('requestClientCode', { status: 'busy' }, async () =>
    issueResultOf(
      await readSdfJson<unknown>(
        sql`select public.app_home_code_issue_by_token(
          ${hashShareToken(token)}, ${input.purpose}, ${input.target}, ${input.codeHash}, ${input.ip}, ${input.userAgent}
        ) as data`,
        { write: true },
      ),
    ),
  );
}

/**
 * Tell the database the code it just made was NOT sent (H5 reliability R1):
 * it is marked used by its own id, so it authorises nothing and spends no day
 * limit, only its target's 60 s spacing. `ok`, or why it was not marked:
 * `gone` (no such live, untried code of this link) or `busy`.
 */
export async function markClientCodeUnsentByToken(rawToken: string, challengeId: string): Promise<'ok' | 'gone' | 'busy'> {
  const token = normalizeRawToken(rawToken);
  if (!token) return 'gone';
  const answer = await readSdfCode(
    sql`select public.app_home_code_unsent_by_token(${hashShareToken(token)}, ${challengeId}::uuid) as code`,
    { write: true },
  );
  return answer === 'ok' || answer === 'busy' ? answer : 'gone';
}
