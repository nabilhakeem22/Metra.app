import 'server-only';
// Public (no-session) contract share. Runs the SECURITY DEFINER token SDFs on the
// base connection — NO withOrgContext, NO org GUCs. The token IS the auth. The
// SDF omits every cost/margin column, so nothing here can leak the firm's cost.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface PublicContractLine {
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

export interface PublicContractSection {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  section_subtotal: string;
  sort_order: number;
  lines: PublicContractLine[];
}

export interface PublicContract {
  id: string;
  number: number;
  status: string;
  title_ar: string | null;
  title_en: string | null;
  currency: string;
  signature_date: string | null;
  start_date: string | null;
  end_date: string | null;
  retention_pct: string;
  retention_release_terms_ar: string | null;
  retention_release_terms_en: string | null;
  advance_pct: string;
  advance_recovery_method: string;
  payment_terms_days: number | null;
  payment_schedule_mode: string;
  penalty_ar: string | null;
  penalty_en: string | null;
  defects_liability_days: number | null;
  scope_inclusions_ar: string | null;
  scope_inclusions_en: string | null;
  scope_exclusions_ar: string | null;
  scope_exclusions_en: string | null;
  terms_ar: string | null;
  terms_en: string | null;
  discount_pct: string;
  tax_rate: string;
  supervision_pct: string;
  subtotal: string;
  discount_amount: string;
  taxable_base: string;
  tax_amount: string;
  supervision_amount: string;
  original_value: string;
  total: string;
  share_expires_at: string | null;
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  sections: PublicContractSection[];
}

export async function getContractByToken(
  rawToken: string,
): Promise<PublicContract | null> {
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_contract_by_token(${hash}) as data`),
  )) as unknown as Array<{ data: PublicContract | null }>;
  return rows[0]?.data ?? null;
}

/** A stable content hash of the acknowledged document (the "PDF hash" per A5). */
export function contractPayloadHash(contract: PublicContract): string {
  return createHash('sha256')
    .update(JSON.stringify(contract))
    .digest('hex');
}

export type AckError = 'token_invalid' | 'token_expired' | 'already_responded';

export async function acknowledgeContractByToken(
  rawToken: string,
  input: {
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    pdfHash?: string | null;
  },
): Promise<{ ok: boolean; error?: AckError }> {
  if (!rawToken || !rawToken.trim()) return { ok: false, error: 'token_invalid' };
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_contract_ack_by_token(
      ${hash}, ${input.actorName ?? null}, ${input.ip ?? null},
      ${input.userAgent ?? null}, ${input.pdfHash ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  const code = rows[0]?.code;
  switch (code) {
    case 'ok':
      return { ok: true };
    case 'expired':
      return { ok: false, error: 'token_expired' };
    case 'already':
      return { ok: false, error: 'already_responded' };
    default:
      return { ok: false, error: 'token_invalid' };
  }
}
