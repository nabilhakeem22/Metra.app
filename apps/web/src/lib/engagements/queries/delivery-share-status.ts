import 'server-only';
import { designEngagements } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The client-share status of a delivery, for the cockpit "Share with client"
 * control. Reports ONLY whether a live link exists (token_hash is set) plus its
 * optional expiry — it NEVER returns the token_hash itself. RLS scopes the read to
 * the caller's org (a foreign delivery reads as not-shared). The CALLER gates the
 * read on an engagements capability; this is display state, not the token.
 */
export interface DeliveryShareStatus {
  shared: boolean;
  expiresAt: string | null;
}

export function getDeliveryShareStatus(
  ctx: OrgContext,
  engagementId: string,
): Promise<DeliveryShareStatus> {
  return withOrgContext(ctx, async (tx) => {
    const [row] = await tx
      .select({
        // Derive a boolean at the DB — the hash itself never crosses this boundary.
        shared: sql<boolean>`${designEngagements.tokenHash} is not null`,
        expiresAt: designEngagements.shareExpiresAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);
    return {
      shared: row?.shared ?? false,
      expiresAt: row?.expiresAt?.toISOString() ?? null,
    };
  });
}
