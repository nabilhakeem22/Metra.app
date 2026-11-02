// The client home's answer as the studio is shown it: the link to copy, why
// there is none, or the refusal in words. PURE and server-safe; the words come
// from the caller's `describe`, so this holds no catalogue.
import type { ActionResult } from '@/lib/actions/result';
import type { ClientHomeAnswer, ClientHomeLinkReason } from '@/lib/client-home/types';
import { designFirstTargetOf, type DesignFirstTarget } from '@/lib/engagements/design-first';

export type ClientHomeShown =
  | { link: string }
  | { reason: ClientHomeLinkReason }
  /** `target`: the delivery a design-first refusal sends the studio to. */
  | { error: string; target?: DesignFirstTarget | null };

export function clientHomeShownOf(
  res: ClientHomeAnswer,
  describe: (failure: ActionResult & { ok: false }) => string,
): ClientHomeShown {
  if (!res.ok) return { error: describe(res), target: designFirstTargetOf(res) };
  return res.link === null ? { reason: res.linkReason } : { link: res.link };
}
