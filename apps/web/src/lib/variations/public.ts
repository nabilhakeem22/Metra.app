import 'server-only';
// Public (no-session) variation-order share. Runs the SECURITY DEFINER token SDFs
// on the base connection — NO withOrgContext, NO org GUCs. The token IS the auth.
// The SDF omits every cost/margin column, so nothing here can leak the firm's cost.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

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
  org: { name_ar: string | null; name_en: string | null; logo_file_id: string | null };
  lines: PublicVariationLine[];
}

export async function getVariationByToken(
  rawToken: string,
): Promise<PublicVariation | null> {
  if (!rawToken || !rawToken.trim()) return null;
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_variation_by_token(${hash}) as data`),
  )) as unknown as Array<{ data: PublicVariation | null }>;
  return rows[0]?.data ?? null;
}

export type RespondError = 'token_invalid' | 'token_expired' | 'already_responded';

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
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_variation_respond_by_token(
      ${hash}, ${input.decision}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
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
