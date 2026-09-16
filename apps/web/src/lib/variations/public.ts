import 'server-only';
// Public (no-session) variation-order share. The SECURITY DEFINER token SDFs run
// through `lib/share/sdf-call`, the one sanctioned base-connection surface — NO
// withOrgContext, NO org GUCs. The token IS the auth. The SDF omits every
// cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
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
  /**
   * WHO rejected this variation order, or null when nothing was recorded (0051).
   * 'client' is the client's own refusal through the token path; 'staff' is the
   * termination cascade, which is the only staff route to `rejected` — there is
   * no staff "reject VO" action. null is every row written before 0051.
   */
  rejectionChannel: 'client' | 'staff' | null;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  lines: PublicVariationLine[];
}

/** The SDF's snake_case document, before it is mapped onto PublicVariation. */
type VariationTokenDocument = Omit<
  PublicVariation,
  'contractActive' | 'rejectionChannel'
> & {
  contract_active: boolean | null;
  rejection_channel: unknown;
};

/**
 * The recorded rejection channel, or null — mapped DEFENSIVELY, exactly as
 * `contract_active` is: anything that is not the string 'client' or 'staff'
 * becomes null, including the `undefined` an un-applied function returns. null
 * then falls through the decided-message ladder to today's wording, so an app
 * that knows this field can read a database that does not yet write it.
 */
function toRejectionChannel(value: unknown): 'client' | 'staff' | null {
  return value === 'client' || value === 'staff' ? value : null;
}

export async function getVariationByToken(
  rawToken: string,
): Promise<PublicVariation | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const hash = hashShareToken(token);
  const document = await readSdfJson<VariationTokenDocument>(
    sql`select public.app_variation_by_token(${hash}) as data`,
  );
  if (!document) return null;
  const {
    contract_active: contractActive,
    rejection_channel: rejectionChannel,
    ...rest
  } = document;
  // Only an explicit false marks the contract dead. The respond SDF is the real
  // gate, so a document from an un-applied function must not black out the portal.
  return {
    ...rest,
    contractActive: contractActive !== false,
    rejectionChannel: toRejectionChannel(rejectionChannel),
  };
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
  const token = normalizeRawToken(rawToken);
  if (!token) return { ok: false, error: 'token_invalid' };
  const hash = hashShareToken(token);
  const code = await readSdfCode(sql`select public.app_variation_respond_by_token(
    ${hash}, ${input.decision}, ${input.actorName ?? null},
    ${input.ip ?? null}, ${input.userAgent ?? null}
  ) as code`);
  return mapDocumentSdfCode(code);
}
