import 'server-only';
// Where an old contract link (/c) sends its holder now (H6.3): a BOQ contract
// is signed in the client home, so while it awaits that signature its /c link
// opens the home's Execution tab on the contract. Every other link has nothing
// to do in the home and shows its own document. ONE token SDF,
// `app_client_home_target_by_token('contract', hash)`, ONE HMAC re-derive of
// the home's live link and ONE check that the home shows this contract, all
// through lib/share/sdf-call (no session: the token IS the auth). The raw
// tokens, the hashes and the ids are never logged. H7.2 generalises this to
// change-order links.
import { sql } from 'drizzle-orm';
import type { Locale } from '@/i18n/routing';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';
import { isOpenForSigning, signsInClientHome } from '@/lib/contracts/home-signing';
import type { PublicContract } from '@/lib/contracts/public-types';
import { DbDeadlineError } from '@/lib/db/client';
import { tokenPathSegment } from '@/lib/engagements/portal-path';
import { isRecord } from '@/lib/guards/is-record';
import { rederiveDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { normalizeRawToken, readSdfJson } from '@/lib/share/sdf-call';
import { hashShareToken } from '@/lib/share/token';
import { isUuid } from '@/lib/uuid';
import { getHomeContractSections } from './contract';
import { homeHref } from './tab';

/**
 * How long a /c request waits for the home before it shows the link's own
 * document (reliability M1): a stalled lookup must not hold the page for the
 * database's whole deadline, or take it down.
 */
export const REDIRECT_LOOKUP_WAIT_MS = 3_500;

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

/** Which read of the lookup is running, so a failure names its step. */
interface LookupProgress {
  step: 'target' | 'current_contract';
}

/**
 * The home's raw link when that home shows THIS contract, else null. The home
 * can stand on a newer contract (functional F1). The target SDF does not say
 * so, and the home's sections read does (bound to its contract now, DB step
 * D): asked from past the contract's last section, it reads no section.
 */
async function homeRawShowing(
  token: string,
  contract: Pick<PublicContract, 'id' | 'section_count'>,
  progress: LookupProgress,
): Promise<string | null> {
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
  progress.step = 'current_contract';
  const shown = await getHomeContractSections(homeRaw, contract.id, contract.section_count);
  return shown === null ? null : homeRaw;
}

/**
 * The home path an old /c link redirects to,
 * `/${locale}/d/${homeRaw}?tab=execution&focus=contract`, or null to render /c.
 * Only a BOQ contract still awaiting its signature, in its window (security
 * S1), asks at all, so a proposal, signed or terminated contract's link reads
 * nothing more than on main. Null too for a home that is not live, that shows
 * another contract, or whose link this server cannot re-derive. A lookup that
 * fails or outlasts REDIRECT_LOOKUP_WAIT_MS is logged once, redacted, and is
 * null: the link's own document, never an error page because of the lookup.
 */
export async function contractHomeRedirect(
  rawToken: string,
  contract: PublicContract | null,
  locale: Locale,
): Promise<string | null> {
  const token = normalizeRawToken(rawToken);
  if (!token || !contract || !signsInClientHome(contract) || !isOpenForSigning(contract, Date.now())) return null;
  const progress: LookupProgress = { step: 'target' };
  const lookup = homeRawShowing(token, contract, progress);
  try {
    if (!(await settledWithin(lookup, REDIRECT_LOOKUP_WAIT_MS))) throw new DbDeadlineError();
    const homeRaw = await lookup;
    return homeRaw && `/${locale}${homeHref(tokenPathSegment(homeRaw), 'execution')}&focus=contract`;
  } catch (error) {
    console.error('contractHomeRedirect: lookup failed', { step: progress.step, failure: loggableFailure(error) });
    return null;
  }
}
