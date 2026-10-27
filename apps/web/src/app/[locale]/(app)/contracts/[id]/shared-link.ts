// What the contract page shows the studio to send the client after an act.
// PURE and server-safe: a document's own link (a proposal contract's /c, a
// change order's /v), or, for an execution contract just issued, its client
// home (H6.4), where the client signs with a code.
import type { ActionResult } from '@/lib/actions/result';
import type { ClientHomeAnswer } from '@/lib/client-home/types';

export type SharedLink = { kind: 'document'; link: string } | { kind: 'home'; answer: ClientHomeAnswer };

/** The link an act's answer hands over: the client home first, else the document's link, else none. */
export function sharedLinkOf(res: ActionResult & { clientHome?: ClientHomeAnswer }): SharedLink | null {
  if (res.clientHome) return { kind: 'home', answer: res.clientHome };
  return res.link ? { kind: 'document', link: res.link } : null;
}
