import 'server-only';
// Public (no-session) variation-order share. The SECURITY DEFINER token SDFs run
// through `lib/share/sdf-call`, the one sanctioned base-connection surface — NO
// withOrgContext, NO org GUCs. The token IS the auth. The SDF omits every
// cost/margin column, so nothing here can leak the firm's cost.
import { sql } from 'drizzle-orm';
import { normalizeRawToken, readSdfCode, readSdfJson } from '@/lib/share/sdf-call';
import { mapDocumentSdfCode, type TokenResponseError } from '@/lib/share/sdf-result';
import { hashShareToken } from '@/lib/share/token';
import { publicVariationOf } from './public-shape';
import type { PublicVariation, VariationTokenDocument } from './public-types';

export async function getVariationByToken(
  rawToken: string,
): Promise<PublicVariation | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const hash = hashShareToken(token);
  const document = await readSdfJson<VariationTokenDocument>(
    sql`select public.app_variation_by_token(${hash}) as data`,
  );
  return document && publicVariationOf(document);
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
