import 'server-only';
// Where an old document link sends its holder now: a BOQ contract is signed
// (H6.3), and its change orders are decided (H7.2), in the client home, so while
// one awaits that act its /c or /v link opens the home's Execution tab on it.
// Every other link has nothing to do in the home and shows its own document. ONE
// token SDF, `app_client_home_target_by_token(kind, hash)`, ONE HMAC re-derive of
// the home's live link and ONE check that the home shows this document, all
// through lib/share/sdf-call (no session: the token IS the auth). The raw tokens,
// the hashes and the ids are never logged.
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
import { decidesInClientHome, isOpenForDecision } from '@/lib/variations/home-deciding';
import type { PublicVariation } from '@/lib/variations/public-types';
import { getHomeContractSections } from './contract';
import { homeHref } from './tab';
import { homeShowsOpenChangeOrder } from './variations';

/**
 * How long a document link's request waits for the home before it shows the
 * link's own document (reliability M1): a stalled lookup must not hold the page
 * for the database's whole deadline, or take it down.
 */
export const REDIRECT_LOOKUP_WAIT_MS = 3_500;

/** The home that owns the document, as the SQL answers it. */
interface HomeTarget {
  engagement_id: string;
  token_hash: string;
  token_nonce: string | null;
  focus_id: unknown;
}

function isHomeTarget(row: unknown): row is HomeTarget {
  return (
    isRecord(row) &&
    isUuid(row.engagement_id) &&
    typeof row.token_hash === 'string' &&
    (row.token_nonce === null || typeof row.token_nonce === 'string')
  );
}

/** A link's document that awaits its act in the home: which kind, and how to ask about it. */
interface HomeDocument {
  kind: 'contract' | 'variation';
  /** The home's `?focus=` for the row the SQL answered; null when the row is not one this build can read. */
  focusOf: (target: HomeTarget) => string | null;
  /** Does the home behind this raw link show the document now? */
  shownBy: (homeRaw: string) => Promise<boolean>;
}

/** Which read of the lookup is running, so a failure names its step. */
interface LookupProgress {
  step: 'target' | 'home_shows';
}

/** The home's path that opens on the document, or null when its link cannot be re-derived or it shows another. */
async function homePathShowing(token: string, document: HomeDocument, progress: LookupProgress): Promise<{ homeRaw: string; focus: string } | null> {
  const row = await readSdfJson<unknown>(
    sql`select public.app_client_home_target_by_token(${document.kind}, ${hashShareToken(token)}) as data`,
  );
  if (row === null) return null;
  const focus = isHomeTarget(row) ? document.focusOf(row) : null;
  if (!isHomeTarget(row) || focus === null) {
    console.error('documentHomeRedirect: unexpected target shape');
    return null;
  }
  const homeRaw = rederiveDeliveryLinkToken(row.engagement_id, row.token_nonce, row.token_hash);
  if (homeRaw === null) return null;
  progress.step = 'home_shows';
  return (await document.shownBy(homeRaw)) ? { homeRaw, focus } : null;
}

/**
 * The home path a link redirects to, or null to render its own document. Null
 * for a home that is not live, that does not show the document, or whose link
 * this server cannot re-derive. A lookup that fails or outlasts
 * REDIRECT_LOOKUP_WAIT_MS is logged once, redacted, and is null: the link's own
 * document, never an error page because of the lookup.
 */
async function documentHomeRedirect(rawToken: string, document: HomeDocument | null, locale: Locale): Promise<string | null> {
  const token = normalizeRawToken(rawToken);
  if (!token || !document) return null;
  const progress: LookupProgress = { step: 'target' };
  const lookup = homePathShowing(token, document, progress);
  try {
    if (!(await settledWithin(lookup, REDIRECT_LOOKUP_WAIT_MS))) throw new DbDeadlineError();
    const path = await lookup;
    return path && `/${locale}${homeHref(tokenPathSegment(path.homeRaw), 'execution')}&focus=${path.focus}`;
  } catch (error) {
    console.error('documentHomeRedirect: lookup failed', { kind: document.kind, step: progress.step, failure: loggableFailure(error) });
    return null;
  }
}

/**
 * Where an old /c link leads. Only a BOQ contract still awaiting its signature,
 * in its window (security S1), asks at all, so a proposal, signed or terminated
 * contract's link reads nothing more than on main. The home can stand on a newer
 * contract (functional F1): the target SDF does not say so, and the home's
 * sections read does (bound to its contract now, DB step D): asked from past the
 * contract's last section, it reads no section.
 */
export function contractHomeRedirect(rawToken: string, contract: PublicContract | null, locale: Locale): Promise<string | null> {
  const asks = contract !== null && signsInClientHome(contract) && isOpenForSigning(contract, Date.now());
  return documentHomeRedirect(
    rawToken,
    asks
      ? {
          kind: 'contract',
          focusOf: () => 'contract',
          shownBy: async (homeRaw) => (await getHomeContractSections(homeRaw, contract.id, contract.section_count)) !== null,
        }
      : null,
    locale,
  );
}

/**
 * Where an old /v link leads. Only a BOQ contract's change order still awaiting
 * the client's decision, in its window, asks at all (as for /c, security S1), so
 * every other link reads nothing more than on main. The home lists the newest 10
 * orders of its current contract, so an order it does not list stays on /v.
 */
export function variationHomeRedirect(rawToken: string, variation: PublicVariation | null, locale: Locale): Promise<string | null> {
  const asks = variation !== null && decidesInClientHome(variation) && isOpenForDecision(variation, Date.now());
  return documentHomeRedirect(
    rawToken,
    asks
      ? {
          kind: 'variation',
          focusOf: ({ focus_id: id }) => (isUuid(id) ? `variation:${id.toLowerCase()}` : null),
          shownBy: (homeRaw) => homeShowsOpenChangeOrder(homeRaw, variation.id),
        }
      : null,
    locale,
  );
}
