import 'server-only';
// Where an old contract link (/c) sends its holder now (H6.3, AC29-30): a BOQ
// contract is signed in the client home, so its /c link opens the home's
// Execution tab on the contract. ONE token SDF,
// `app_client_home_target_by_token('contract', hash)`, through
// lib/share/sdf-call (no session: the contract token IS the auth), and ONE
// HMAC re-derive of the home's live link. The raw tokens, the hashes and the
// ids are never logged. H7.2 generalises this to change-order links.
import { sql } from 'drizzle-orm';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { isRecord } from '@/lib/guards/is-record';
import { rederiveDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { homeHref } from './tab';

/** The home that owns the contract, as the SQL answers it (focus_id is H7.2's). */
interface HomeTarget {
  engagement_id: string;
  token_hash: string;
  token_nonce: string | null;
}

function isHomeTarget(row: unknown): row is HomeTarget {
  return (
    isRecord(row) &&
    isUuid(row.engagement_id) &&
    typeof row.token_hash === 'string' &&
    (row.token_nonce === null || typeof row.token_nonce === 'string')
  );
}

/**
 * The home path an old /c link redirects to,
 * `/${locale}/d/${homeRaw}?tab=execution&focus=contract`, or null to render /c
 * as before: a blank token (no round trip), a token that is no live BOQ
 * contract's with a live home, or a home link this server cannot re-derive.
 * A throw from the read propagates (the page's error boundary, as /c's own
 * read does), so a valid link during a database blip is never called moved.
 */
export async function contractHomeRedirect(rawToken: string, locale: string): Promise<string | null> {
  const token = normalizeRawToken(rawToken);
  if (!token) return null;
  const row = await readSdfJson<unknown>(
    sql`select public.app_client_home_target_by_token('contract', ${hashShareToken(token)}) as data`,
  );
  if (row === null) return null;
  if (!isHomeTarget(row)) {
    console.error('contractHomeRedirect: unexpected target shape');
    return null;
  }
  const homeRaw = rederiveDeliveryLinkToken(row.engagement_id, row.token_nonce, row.token_hash);
  if (homeRaw === null) return null;
  return `/${locale}${homeHref(tokenPathSegment(homeRaw), 'execution')}&focus=contract`;
}
