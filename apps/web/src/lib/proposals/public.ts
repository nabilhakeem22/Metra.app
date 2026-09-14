import 'server-only';
// Public (no-session) proposal share. Runs the SECURITY DEFINER token SDFs on the
// base connection — NO withOrgContext, NO org GUCs. The token IS the auth. The
// SDF omits every cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
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
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_proposal_by_token(${hash}) as data`),
  )) as unknown as Array<{ data: PublicProposal | null }>;
  return rows[0]?.data ?? null;
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
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_proposal_respond_by_token(
      ${hash}, ${input.decision}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  return mapDocumentSdfCode(rows[0]?.code);
}
