// What the contract page shows the studio to send the client after an act.
// PURE and server-safe: a document's own link (a proposal contract's /c, a
// change order's /v), or, for an execution contract just issued, its client
// home (H6.4), where the client signs with a code.
import type { ActionCode, ActionResult } from '@/lib/actions/result';
import type { ClientHomeAnswer } from '@/lib/client-home/types';

export type SharedLink = { kind: 'document'; link: string } | { kind: 'home'; answer: ClientHomeAnswer };

/**
 * The home refusals another try can get past: the database was busy or lost the
 * answer, something unclassified failed (`generic`), or a link was written
 * meanwhile. Every other code answers the same on every try, so the studio is
 * never sent round in a loop.
 */
const HOME_RETRY_MAY_HELP: ReadonlySet<ActionCode> = new Set<ActionCode>(['busy', 'engagement_state_conflict', 'generic', 'uncertain']);

/** Whether trying the Client page control again can bring a home this answer could not. */
export function homeRetryMayHelp(answer: ClientHomeAnswer): boolean {
  return !answer.ok && answer.error !== undefined && HOME_RETRY_MAY_HELP.has(answer.error);
}

/** The link an act's answer hands over: the client home first, else the document's link, else none. */
export function sharedLinkOf(res: ActionResult & { clientHome?: ClientHomeAnswer }): SharedLink | null {
  if (res.clientHome) return { kind: 'home', answer: res.clientHome };
  return res.link ? { kind: 'document', link: res.link } : null;
}
