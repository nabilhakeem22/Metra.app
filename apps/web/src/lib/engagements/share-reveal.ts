// Round B (B11): show the studio the client link the client ALREADY holds,
// instead of minting a new one. The link is re-derived from the stored nonce
// under SHARE_LINK_SECRET and handed out ONLY when its sha256 equals the
// stored token_hash (lib/share/delivery-link-token.ts), so a rotated secret
// or a stale nonce can never resurrect a superseded link.
//
// Owner/admin only (`engagements_issue` approve, the capability that mints
// and rotates the link), enforced here on the server; every reveal is audited.
// The raw token is returned to the caller and never logged or stored.
import { designEngagements, type MetraDb } from '@metra/db';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { rederiveDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { isUuid } from '@/lib/uuid';
import { isTerminal, type DesignState } from './states';

/** Who may see or resend the existing client link: whoever may mint it. */
export const DELIVERY_LINK_GATE = {
  capability: 'engagements_issue',
  action: 'approve',
  flow: 'interior',
} as const;

export interface LiveDeliveryLink {
  /** The raw token the client holds now. Never log it. */
  raw: string;
  state: DesignState;
  clientId: string;
}

/**
 * The delivery's live link, re-derived, inside the caller's RLS transaction.
 * `engagement_not_found` for a foreign, absent or malformed id;
 * `delivery_link_unrecoverable` when there is no live link (never shared,
 * revoked, expired) or it cannot be re-derived (minted before B11 or without
 * the secret, a rotated secret, a nonce that does not match the hash).
 * With `activeOnly`, a closed or abandoned delivery answers
 * `engagement_not_active` first: there is nobody to remind, and no link to
 * replace for it.
 */
export async function readLiveDeliveryLink(
  tx: MetraDb,
  engagementId: string,
  options: { activeOnly?: boolean } = {},
): Promise<LiveDeliveryLink> {
  if (!isUuid(engagementId)) fail('engagement_not_found');
  const row = await requireInOrg(
    tx,
    designEngagements,
    engagementId,
    {
      id: designEngagements.id,
      state: designEngagements.state,
      clientId: designEngagements.clientId,
      tokenHash: designEngagements.tokenHash,
      tokenNonce: designEngagements.tokenNonce,
      shareExpiresAt: designEngagements.shareExpiresAt,
    },
    'engagement_not_found',
  );
  if (options.activeOnly && isTerminal(row.state)) fail('engagement_not_active');
  const live =
    row.tokenHash !== null && (row.shareExpiresAt === null || row.shareExpiresAt > new Date());
  const raw = live ? rederiveDeliveryLinkToken(row.id, row.tokenNonce, row.tokenHash) : null;
  if (raw === null) fail('delivery_link_unrecoverable');
  return { raw, state: row.state, clientId: row.clientId };
}

/**
 * Reveal the existing client link (its RAW token in `data`) without rotating
 * it. Audited as an `issue` on the delivery. Never throws to the client.
 */
export function revealDeliveryLinkCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(ctx, DELIVERY_LINK_GATE, async (tx, audit) => {
    const link = await readLiveDeliveryLink(tx, engagementId);
    await audit({
      entity: 'design_engagement',
      entityId: engagementId,
      action: 'issue',
      before: { revealed: false },
      after: { revealed: true },
    });
    return link.raw;
  });
}
