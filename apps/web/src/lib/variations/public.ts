import 'server-only';
// Public (no-session) variation-order share. Runs the SECURITY DEFINER token SDFs
// on the base connection — NO withOrgContext, NO org GUCs. The token IS the auth.
// The SDF omits every cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import { mapDocumentSdfCode, type TokenResponseError } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';

export interface PublicVariationLine {
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

export interface PublicVariation {
  id: string;
  number: number;
  status: string;
  title_ar: string | null;
  title_en: string | null;
  reason_ar: string | null;
  reason_en: string | null;
  net_delta: string;
  currency: string;
  contract_number: number;
  share_expires_at: string | null;
  /** Is the parent contract still commercially live (issued or signed)? */
  contractActive: boolean;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  lines: PublicVariationLine[];
}

/** The SDF's snake_case document, before it is mapped onto PublicVariation. */
type VariationTokenDocument = Omit<PublicVariation, 'contractActive'> & {
  contract_active: boolean | null;
};

export async function getVariationByToken(
  rawToken: string,
): Promise<PublicVariation | null> {
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_variation_by_token(${hash}) as data`),
  )) as unknown as Array<{ data: VariationTokenDocument | null }>;
  const document = rows[0]?.data ?? null;
  if (!document) return null;
  const { contract_active: contractActive, ...rest } = document;
  // Only an explicit false marks the contract dead. The respond SDF is the real
  // gate, so a document from an un-applied function must not black out the portal.
  return { ...rest, contractActive: contractActive !== false };
}

/** The variation approve/reject surface, which additionally reaches
 *  contract_inactive. An alias, not a narrower union. */
export type RespondError = TokenResponseError;

export async function respondToVariationByToken(
  rawToken: string,
  input: {
    decision: 'approve' | 'reject';
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ ok: boolean; error?: RespondError }> {
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(rawToken);
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_variation_respond_by_token(
      ${hash}, ${input.decision}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  return mapDocumentSdfCode(rows[0]?.code);
}
