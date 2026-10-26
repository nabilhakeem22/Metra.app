import 'server-only';
// The one-time codes of the client home, the server's half: making a code and
// asking the database for it (app_home_code_issue_by_token, the ONE token
// function a code request runs). The raw code exists only here, in the email
// and in what the client types: the database is passed sha256(challengeId:code)
// and nothing in this file logs or returns the code to the browser.
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { formatDocNumber, type DocPrefix } from '@/lib/format/doc-number';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import type { CodePurpose } from './code-answers';

/** A fresh code and the challenge it answers. `codeHash` is all the database ever sees. */
export interface NewClientCode {
  challengeId: string;
  code: string;
  codeHash: string;
}

/** sha256 of `challengeId:code`, lower-case hex: the code bound to its challenge. */
export function clientCodeHash(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

/** Six digits from the CSPRNG, zero-padded, and a challenge id of the app's own. */
export function newClientCode(): NewClientCode {
  const challengeId = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return { challengeId, code, codeHash: clientCodeHash(challengeId, code) };
}

/** The studio and the document an issued code's email names, as the database read them. */
export interface CodeEmailFacts {
  /** The client's address on file, for the send only: it never leaves the server. */
  email: string;
  studio: { nameAr: string | null; nameEn: string | null };
  documentNumber: string;
}

/** What the issue function answered. */
export type CodeIssueResult =
  | ({ status: 'ok'; hint: string; resendAfterSeconds: number; platformDayHalf: boolean } & CodeEmailFacts)
  | { status: 'too_many'; retryAfterSeconds: number }
  | { status: 'no_channel' | 'not_available' | 'busy' | 'invalid' | 'expired' };

const REFUSALS = new Set(['no_channel', 'not_available', 'busy', 'invalid', 'expired']);
const DOC_PREFIXES = new Set<DocPrefix>(['C', 'VO', 'PR', 'DE']);

interface IssuePayload {
  status?: unknown;
  email?: unknown;
  hint?: unknown;
  resend_after_seconds?: unknown;
  retry_after_seconds?: unknown;
  platform_day_half?: unknown;
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

/**
 * The issue function's answer, read strictly. An answer this build cannot read
 * is the server's own defect and throws (developer-only): the action answers
 * it as a failure with a reference, never as a sent code.
 */
export function issueResultOf(payload: unknown): CodeIssueResult {
  const answer = (payload ?? {}) as IssuePayload;
  if (answer.status === 'too_many' && Number.isInteger(answer.retry_after_seconds)) {
    return { status: 'too_many', retryAfterSeconds: answer.retry_after_seconds as number };
  }
  if (typeof answer.status === 'string' && REFUSALS.has(answer.status)) {
    return { status: answer.status as 'no_channel' | 'not_available' | 'busy' | 'invalid' | 'expired' };
  }
  const documentNumber = documentNumberOf(answer.document);
  if (
    answer.status === 'ok' &&
    typeof answer.email === 'string' &&
    typeof answer.hint === 'string' &&
    Number.isInteger(answer.resend_after_seconds) &&
    typeof answer.platform_day_half === 'boolean' &&
    documentNumber !== null
  ) {
    return {
      status: 'ok',
      email: answer.email,
      hint: answer.hint,
      resendAfterSeconds: answer.resend_after_seconds as number,
      platformDayHalf: answer.platform_day_half,
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
 * writes the challenge row, in one statement; nothing is written unless it
 * answers `ok`. A WRITE: a deadline on Cloudflare is "may have applied",
 * never "nothing written".
 */
export async function issueClientCodeByToken(
  rawToken: string,
  input: { code: NewClientCode; purpose: CodePurpose; target: string; ip: string | null; userAgent: string | null },
): Promise<CodeIssueResult> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { status: 'invalid' };
  const payload = await readSdfJson<unknown>(
    sql`select public.app_home_code_issue_by_token(
      ${hashShareToken(token)}, ${input.code.challengeId}::uuid, ${input.purpose}, ${input.target}, ${input.code.codeHash},
      ${input.ip}, ${input.userAgent}
    ) as data`,
    { write: true },
  );
  return issueResultOf(payload);
}
