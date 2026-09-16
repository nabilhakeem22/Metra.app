import 'server-only';
// Public (no-session) proposal share. The SECURITY DEFINER token SDFs run through
// `lib/share/sdf-call`, the one sanctioned base-connection surface — NO
// withOrgContext, NO org GUCs. The token IS the auth. The SDF omits every
// cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { mapDocumentSdfCode, type TokenResponseError } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';

export interface PublicProposalLine {
  id: string;
  description_ar: string | null;
  description_en: string | null;
  qty: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  sort_order: number;
}

export interface PublicProposalSection {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  section_subtotal: string;
  sort_order: number;
  lines: PublicProposalLine[];
}

export interface PublicProposal {
  id: string;
  number: number;
  status: string;
  title_ar: string | null;
  title_en: string | null;
  currency: string;
  issue_date: string | null;
  expiry_date: string | null;
  discount_pct: string;
  tax_rate: string;
  subtotal: string;
  discount_amount: string;
  taxable_base: string;
  tax_amount: string;
  total: string;
  notes_ar: string | null;
  notes_en: string | null;
  terms_ar: string | null;
  terms_en: string | null;
  share_expires_at: string | null;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  sections: PublicProposalSection[];
}

export async function getProposalByToken(
  rawToken: string,
): Promise<PublicProposal | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const hash = hashShareToken(token);
  return readSdfJson<PublicProposal>(
    sql`select public.app_proposal_by_token(${hash}) as data`,
  );
}

/** The proposal accept/reject surface reaches token_invalid, token_expired and
 *  already_responded. An alias, not a narrower union: one widened code from a
 *  newer SDF must still be a value the portal can hold and fall through on. */
export type RespondError = TokenResponseError;

export async function respondToProposalByToken(
  rawToken: string,
  input: {
    decision: 'accept' | 'reject';
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ ok: boolean; error?: RespondError }> {
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_proposal_respond_by_token(
    ${hash}, ${input.decision}, ${input.actorName ?? null},
    ${input.ip ?? null}, ${input.userAgent ?? null}
  ) as code`);
  return mapDocumentSdfCode(code);
}
