import type { PublicDelivery } from '@/lib/engagements/public/types';

/**
 * The instalments claimed in this visit that no read has shown pending yet: only
 * those still need the local flip. Once a read shows one, the server is the truth
 * for it, so a claim the studio dismisses later reads claimable again. The same
 * set when nothing was shown. PURE.
 */
export function claimsNotYetRead(
  claimedThisSession: ReadonlySet<string>,
  claim: PublicDelivery['paymentClaim'],
): ReadonlySet<string> {
  const shown = (claim?.claimableMilestones ?? []).filter(
    (milestone) => milestone.hasPendingClaim && claimedThisSession.has(milestone.milestoneKind),
  );
  if (shown.length === 0) return claimedThisSession;
  const unread = new Set(claimedThisSession);
  for (const milestone of shown) unread.delete(milestone.milestoneKind);
  return unread;
}
