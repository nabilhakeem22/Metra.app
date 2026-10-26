import 'server-only';
// Public (no-session) variation-order share. The SECURITY DEFINER token SDFs run
// through `lib/share/sdf-call`, the one sanctioned base-connection surface — NO
// withOrgContext, NO org GUCs. The token IS the auth. The SDF omits every
// cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { mapDocumentSdfCode, type TokenResponseError } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';
import { validIsoDate } from '@/lib/validation/iso-date';

interface PublicVariationLine {
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
   * 'client' is the client's own refusal, through the token path or on paper
   * as the studio recorded it (H7.3: the SDF reads `recorded_on_paper` as
   * 'client'); 'staff' is the termination cascade. null is every row written
   * before 0051.
   */
  rejectionChannel: 'client' | 'staff' | null;
  /**
   * The parent execution contract's VAT and supervision rates, which the order
   * is charged on top of its works (D4a). Null on a proposal contract, whose
   * page shows the net change alone, exactly as before Stage 2.
   */
  charges: { taxRate: string; supervisionPct: string } | null;
  /** Days the order adds to the contract's finish date; null = none recorded. */
  timeExtensionDays: number | null;
  /**
   * The contract's finish as its approved change orders moved it (DB step B,
   * B5 D1): its end date and the days ALL its approved orders add. Null on a
   * proposal contract, and from a database before step B.
   */
  finish: { endDate: string | null; approvedExtensionDays: number } | null;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  lines: PublicVariationLine[];
}

/** The SDF's snake_case document, before it is mapped onto PublicVariation. */
type VariationTokenDocument = Omit<
  PublicVariation,
  'contractActive' | 'rejectionChannel' | 'charges' | 'timeExtensionDays' | 'finish'
> & {
  contract_active: boolean | null;
  rejection_channel: unknown;
  tax_rate: unknown;
  supervision_pct: unknown;
  time_extension_days: unknown;
  contract_source: unknown;
  contract_end_date: unknown;
  time_extension_days_total: unknown;
};

/** A rate as the SDF sends it: a plain non-negative decimal string. */
const RATE_TEXT = /^\d+(\.\d+)?$/;

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

/**
 * The rates the breakdown is computed with, or null, mapped DEFENSIVELY like
 * the channel: only a BOQ contract's order with two well-formed rates gets a
 * breakdown, so a document from an un-applied function keeps today's page.
 */
function toCharges(source: unknown, taxRate: unknown, supervisionPct: unknown): PublicVariation['charges'] {
  if (source !== 'boq' || typeof taxRate !== 'string' || typeof supervisionPct !== 'string') return null;
  return RATE_TEXT.test(taxRate) && RATE_TEXT.test(supervisionPct) ? { taxRate, supervisionPct } : null;
}

/**
 * A BOQ contract's whole, non-negative day count, or null for anything else: a
 * proposal contract's order carries no days in the studio, so none here (F6).
 */
function toExtensionDays(source: unknown, value: unknown): number | null {
  if (source !== 'boq') return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * A BOQ contract's end date and approved days, or null: a proposal contract's
 * order says no finish, and a document without the total (an un-applied
 * function) keeps today's page.
 */
function toFinish(source: unknown, endDate: unknown, total: unknown): PublicVariation['finish'] {
  if (source !== 'boq') return null;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return null;
  const day = typeof endDate === 'string' && validIsoDate(endDate) ? endDate : null;
  return { endDate: day, approvedExtensionDays: total };
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
    tax_rate: taxRate,
    supervision_pct: supervisionPct,
    time_extension_days: timeExtensionDays,
    contract_source: contractSource,
    contract_end_date: contractEndDate,
    time_extension_days_total: approvedExtensionDays,
    ...rest
  } = document;
  // Only an explicit false marks the contract dead. The respond SDF is the real
  // gate, so a document from an un-applied function must not black out the portal.
  return {
    ...rest,
    contractActive: contractActive !== false,
    rejectionChannel: toRejectionChannel(rejectionChannel),
    charges: toCharges(contractSource, taxRate, supervisionPct),
    timeExtensionDays: toExtensionDays(contractSource, timeExtensionDays),
    finish: toFinish(contractSource, contractEndDate, approvedExtensionDays),
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
  ) as code`, { write: true });
  return mapDocumentSdfCode(code);
}
