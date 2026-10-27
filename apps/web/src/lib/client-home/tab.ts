// Which tab of the client home a /d URL asks for, and which section it should
// open on. PURE and server-safe (a plain module, never 'use client', so the
// server page and the client view import the same values).
//
// `/[locale]/d/[token]?tab=design|execution&focus=contract|variation:<id>|request:<id>|instalment:<kind>`:
// a missing or unknown `tab` means the delivery's current phase; an unknown
// `focus` is ignored. `request:` and `instalment:` open that payment's "I've
// made this payment" with its code box: the link a code email carries (H5
// functional F1).
import { claimableMilestoneOf, type ClaimableMilestoneKind } from '@/lib/engagements/claimable-milestones';
import { isUuid } from '@/lib/uuid';

const HOME_TABS = ['design', 'execution'] as const;

export type HomeTab = (typeof HOME_TABS)[number];

/** The section a focus names: on the Execution tab by the element id it gives it, on the design tab a fee instalment. */
export type HomeFocus =
  | { section: 'contract' }
  | { section: 'variation'; id: string }
  | { section: 'request'; id: string }
  | { section: 'instalment'; kind: ClaimableMilestoneKind };

/** A query value as Next hands it over: one string, a repeated key's list, or nothing. */
type QueryValue = string | string[] | undefined;

const single = (value: QueryValue): string | null => (typeof value === 'string' ? value : null);

/** The tab the URL names, or null for the current phase. */
export function requestedTab(value: QueryValue): HomeTab | null {
  const tab = single(value);
  return HOME_TABS.find((candidate) => candidate === tab) ?? null;
}

/** The section the URL asks the home to open on, or null. */
export function requestedFocus(value: QueryValue): HomeFocus | null {
  const focus = single(value);
  if (focus === 'contract') return { section: 'contract' };
  const [section, id, ...rest] = (focus ?? '').split(':');
  if (rest.length > 0) return null;
  if (section === 'instalment') {
    const kind = claimableMilestoneOf(id);
    return kind ? { section, kind } : null;
  }
  if (!isUuid(id)) return null;
  if (section === 'variation' || section === 'request') return { section, id: id.toLowerCase() };
  return null;
}

/** A home URL's path and query for one tab, as the tab strip and the language switch link it. */
export function homeHref(tokenSegment: string, tab: HomeTab | null): string {
  return tab ? `/d/${tokenSegment}?tab=${tab}` : `/d/${tokenSegment}`;
}

/**
 * The home URL that opens ONE payment's "I've made this payment" on its code
 * box, on the tab it lives on: what a code email links to, so the client back
 * from their mail types the code there (H5 functional F1).
 */
export function homePaymentHref(tokenSegment: string, payment: { requestId: string } | { instalment: ClaimableMilestoneKind }): string {
  return 'requestId' in payment
    ? `${homeHref(tokenSegment, 'execution')}&focus=request:${payment.requestId}`
    : `${homeHref(tokenSegment, 'design')}&focus=instalment:${payment.instalment}`;
}
