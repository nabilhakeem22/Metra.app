// The client home's live link, for the studio asking for it inside its
// transaction: the one the client already holds, or a new one when none is live.
import type { MetraDb } from '@metra/db';
import { fail } from '@/lib/actions/mutate';
import { ActionError } from '@/lib/actions/result';
import { readLiveDeliveryLink } from '@/lib/engagements/share-reveal';
import { mintFirstDeliveryLink, renewLapsedDeliveryLink } from '@/lib/engagements/share';
import type { ClientHomeLink, ClientHomeLinkReason } from './types';

/** How the home's link came to be handed back, for the audit row. */
type LinkIssued = 'shown' | 'minted' | 'renewed';

/** The link-reveal refusals that leave the home without a link to hand back. */
const UNSHOWN_LINK: ReadonlySet<string> = new Set(['delivery_links_not_configured', 'delivery_link_unrecoverable']);

/**
 * The home's live link, re-derived. A home with no live link gets one: its
 * first, or a fresh one in place of a link that has lapsed (the client's old
 * link is dead anyway). A link written meanwhile by someone else is
 * `engagement_state_conflict` (try again: it is then the live one).
 */
export async function homeLiveLink(tx: MetraDb, engagementId: string): Promise<ClientHomeLink & { issued: LinkIssued | null }> {
  try {
    return { link: (await readLiveDeliveryLink(tx, engagementId)).raw, issued: 'shown' };
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    if (UNSHOWN_LINK.has(error.code)) return { link: null, linkReason: error.code as ClientHomeLinkReason, issued: null };
    if (error.code !== 'delivery_link_not_shared') throw error;
  }
  const minted = await mintFirstDeliveryLink(tx, engagementId);
  if (minted !== null) return { link: minted, issued: 'minted' };
  const renewed = await renewLapsedDeliveryLink(tx, engagementId);
  if (renewed === null) fail('engagement_state_conflict');
  return { link: renewed, issued: 'renewed' };
}
