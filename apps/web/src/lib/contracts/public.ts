import 'server-only';
// Public (no-session) contract share. The SECURITY DEFINER token SDFs run through
// `lib/share/sdf-call`, the one sanctioned base-connection surface — NO
// withOrgContext, NO org GUCs. The token IS the auth. The SDF omits every
// cost/margin column, so nothing here can leak the firm's cost.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { mapDocumentSdfCode, type TokenResponseError } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import type { PublicContract, PublicSectionLinesPage } from './public-types';

export type {
  PublicContract,
  PublicContractLine,
  PublicContractSection,
  PublicScheduleRow,
  PublicSectionLinesPage,
} from './public-types';

/** The furthest a "show more" may start, the SQL's own clamp. */
const MAX_LINE_OFFSET = 100_000;

/** The lines the /c page opens with, across the whole contract; the rest load on demand. */
const OPENING_LINES = 50;

export async function getContractByToken(
  rawToken: string,
): Promise<PublicContract | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const hash = hashShareToken(token);
  return readSdfJson<PublicContract>(
    sql`select public.app_contract_by_token(${hash}) as data`,
  );
}

/**
 * The snapshot as the page opens it: the first 50 lines of the WHOLE contract,
 * in section order, the way the studio's contract page opens (B1). A section
 * past them opens collapsed, with its line count and "show lines". So the page
 * a client downloads does not grow with the contract, however many sections it
 * has; "show lines" continues each section from where it stands.
 */
export function withOpeningLines(contract: PublicContract): PublicContract {
  let budget = OPENING_LINES;
  return {
    ...contract,
    sections: contract.sections.map((section) => {
      const lines = section.lines.slice(0, budget);
      budget -= lines.length;
      return { ...section, lines };
    }),
  };
}

/**
 * Up to 100 lines of one section of the token's contract, from `offset`. Null,
 * uniformly, for an unknown token, a contract not issued or signed, or a
 * section that is not one of THAT contract's (no oracle about other contracts).
 */
export async function getContractSectionLinesByToken(
  rawToken: string,
  sectionId: unknown,
  offset: unknown,
): Promise<PublicSectionLinesPage | null> {
  const token = normalizeRawToken(rawToken);
  if (!token || typeof sectionId !== 'string' || !isUuid(sectionId)) return null;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > MAX_LINE_OFFSET) {
    return null;
  }
  const hash = hashShareToken(token);
  return readSdfJson<PublicSectionLinesPage>(
    sql`select public.app_contract_section_lines_by_token(${hash}, ${sectionId}::uuid, ${offset}::int) as data`,
  );
}

/**
 * A stable content hash of the acknowledged document (the "PDF hash" per A5).
 *
 * Over the snapshot WITHOUT its per-section `lines`, which `lines_digest`
 * already covers in full (every line's client-visible fields and the schedule,
 * computed in SQL). So the hash says the same thing whether the snapshot
 * carries every line (DB step A) or the first 50 per section (step B), and it
 * changes when any line or schedule row does.
 */
export function contractPayloadHash(contract: PublicContract): string {
  const document = {
    ...contract,
    sections: contract.sections.map(({ lines: _covered, ...section }) => section),
  };
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

/** The contract acknowledgement surface. An alias, not a narrower union: a code
 *  a newer SDF starts returning must still be a value the portal can hold. */
export type AckError = TokenResponseError;

export async function acknowledgeContractByToken(
  rawToken: string,
  input: {
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    pdfHash?: string | null;
  },
): Promise<{ ok: boolean; error?: AckError }> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_contract_ack_by_token(
    ${hash}, ${input.actorName ?? null}, ${input.ip ?? null},
    ${input.userAgent ?? null}, ${input.pdfHash ?? null}
  ) as code`, { write: true });
  return mapDocumentSdfCode(code);
}
