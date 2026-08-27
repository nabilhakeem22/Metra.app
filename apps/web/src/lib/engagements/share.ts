// Client Delivery Portal (P1) — the studio "share with client" token lifecycle.
// ONE durable per-delivery link: mint (first share), rotate (replace — the old
// token dies), revoke (turn the link off). The RAW token is returned ONCE from
// mint/rotate and is NEVER stored or logged — only its sha256 hash is persisted
// in design_engagements.token_hash (unique). All three gate on the owner/admin
// `engagements_issue` capability (the same one the plan reserves for minting
// client share links) and run inside mutateInOrg's RLS tx, so a caller can only
// ever touch a delivery in their own org.
import { designEngagements } from '@metra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintToken } from '@/lib/proposals/core';

/**
 * Mint the FIRST share link for a delivery. Atomic admission gate: sets token_hash
 * only while it is still null (a concurrent second mint finds 0 rows). Returns the
 * RAW token in `data` — reveal it to the studio user ONCE; it is unrecoverable
 * afterwards (only the hash is stored). `share_expires_at` stays null: the link is
 * durable and revocable, never hard-expiring while active. `invalid` means the
 * delivery already has a live link (rotate to replace it).
 */
export async function mintDeliveryLinkCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const { raw, hash } = mintToken();
      const gated = await tx
        .update(designEngagements)
        .set({ tokenHash: hash, shareExpiresAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(designEngagements.id, engagementId),
            isNull(designEngagements.tokenHash),
          ),
        )
        .returning({ id: designEngagements.id });
      if (!gated[0]) {
        // 0 rows: either the delivery is foreign/absent, or it already has a link.
        const [exists] = await tx
          .select({ id: designEngagements.id })
          .from(designEngagements)
          .where(eq(designEngagements.id, engagementId))
          .limit(1);
        fail(exists ? 'invalid' : 'engagement_not_found');
      }
      await audit({
        entity: 'design_engagement',
        entityId: engagementId,
        action: 'issue',
        before: { shared: false },
        after: { shared: true },
      });
      return raw;
    },
  );
}

/**
 * Rotate the share link: overwrite token_hash with a fresh one so the PREVIOUS raw
 * token stops resolving immediately. Returns the new RAW token once. Works whether
 * or not a link currently exists (also the way to re-reveal a link whose raw token
 * was lost). `engagement_not_found` if the delivery is foreign/absent.
 */
export async function rotateDeliveryLinkCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const { raw, hash } = mintToken();
      const updated = await tx
        .update(designEngagements)
        .set({ tokenHash: hash, shareExpiresAt: null, updatedAt: new Date() })
        .where(eq(designEngagements.id, engagementId))
        .returning({ id: designEngagements.id });
      if (!updated[0]) fail('engagement_not_found');
      await audit({
        entity: 'design_engagement',
        entityId: engagementId,
        action: 'issue',
        before: { rotated: true },
        after: { shared: true },
      });
      return raw;
    },
  );
}

/**
 * Revoke the share link: clear token_hash so the raw token 404s at the portal. No
 * raw token is returned. `engagement_not_found` if the delivery is foreign/absent.
 */
export async function revokeDeliveryLinkCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const updated = await tx
        .update(designEngagements)
        .set({ tokenHash: null, shareExpiresAt: null, updatedAt: new Date() })
        .where(eq(designEngagements.id, engagementId))
        .returning({ id: designEngagements.id });
      if (!updated[0]) fail('engagement_not_found');
      await audit({
        entity: 'design_engagement',
        entityId: engagementId,
        action: 'issue',
        before: { shared: true },
        after: { shared: false },
      });
    },
  );
}
