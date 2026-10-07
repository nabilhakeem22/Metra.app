// Client Delivery Portal (P1) — the studio "share with client" token lifecycle.
// ONE durable per-delivery link: mint (first share), rotate (replace — the old
// token dies), revoke (turn the link off). The RAW token is returned from
// mint/rotate and is NEVER stored or logged — only its sha256 hash is persisted
// in design_engagements.token_hash (unique). Round B (B11): the token is an HMAC
// of the delivery id and a per-link nonce under SHARE_LINK_SECRET, and the nonce
// is stored beside the hash in token_nonce, so the studio can show and resend
// the SAME link later (share-reveal.ts, lib/share/delivery-link-token.ts). All
// three gate on the owner/admin
// `engagements_issue` capability (the same one the plan reserves for minting
// client share links) and run inside mutateInOrg's RLS tx, so a caller can only
// ever touch a delivery in their own org.
import { designEngagements } from '@metra/db';
import { and, eq, isNull } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { mintDeliveryLinkToken } from '@/lib/share/delivery-link-token';
import { isUuid } from '@/lib/uuid';

/** The id a link is DERIVED from, as the row stores it (lower case): Postgres
 *  matches any case, the HMAC does not, so reveal could never re-derive it. */
function canonicalEngagementId(engagementId: string): string {
  if (!isUuid(engagementId)) fail('engagement_not_found');
  return engagementId.toLowerCase();
}

/**
 * Mint the FIRST share link for a delivery. Atomic admission gate: sets token_hash
 * only while it is still null (a concurrent second mint finds 0 rows). Returns the
 * RAW token in `data`. Only the hash and the nonce are stored; the token can be
 * re-derived later only while SHARE_LINK_SECRET is set (without it the nonce is
 * null and the token is unrecoverable, as before). `share_expires_at` stays null: the link is
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
      const id = canonicalEngagementId(engagementId);
      const { raw, hash, nonce } = mintDeliveryLinkToken(id);
      const gated = await tx
        .update(designEngagements)
        .set({ tokenHash: hash, tokenNonce: nonce, shareExpiresAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(designEngagements.id, id),
            isNull(designEngagements.tokenHash),
          ),
        )
        .returning({ id: designEngagements.id });
      if (!gated[0]) {
        // 0 rows: either the delivery is foreign/absent, or it already has a link.
        const [exists] = await tx
          .select({ id: designEngagements.id })
          .from(designEngagements)
          .where(eq(designEngagements.id, id))
          .limit(1);
        fail(exists ? 'invalid' : 'engagement_not_found');
      }
      await audit({
        entity: 'design_engagement',
        entityId: id,
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
 * token stops resolving immediately. Returns the new RAW token. Works whether or
 * not a link currently exists; it is also the ONE confirmed replacement for a link
 * that cannot be re-derived (minted before B11, or without the secret).
 * `engagement_not_found` if the delivery is foreign/absent.
 */
export async function rotateDeliveryLinkCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<ActionResult & { data?: string }> {
  return mutateInOrg(
    ctx,
    { capability: 'engagements_issue', action: 'approve', flow: 'interior' },
    async (tx, audit) => {
      const id = canonicalEngagementId(engagementId);
      const { raw, hash, nonce } = mintDeliveryLinkToken(id);
      // The nonce is written in the SAME statement as the hash, so the 0056
      // trigger keeps it (it clears a nonce only when the writer left it as was).
      const updated = await tx
        .update(designEngagements)
        .set({ tokenHash: hash, tokenNonce: nonce, shareExpiresAt: null, updatedAt: new Date() })
        .where(eq(designEngagements.id, id))
        .returning({ id: designEngagements.id });
      if (!updated[0]) fail('engagement_not_found');
      await audit({
        entity: 'design_engagement',
        entityId: id,
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
 * token_nonce is cleared with it: a nonce without a hash is a re-derivable link
 * that no longer exists, and 0056's CHECK refuses one.
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
        .set({
          tokenHash: null,
          tokenNonce: null,
          shareExpiresAt: null,
          updatedAt: new Date(),
        })
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
