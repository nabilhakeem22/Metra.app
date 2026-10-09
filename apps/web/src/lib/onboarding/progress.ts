import 'server-only';
import type { Organization } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isProfileComplete } from '@/lib/org/profile';

export interface OnboardingProgress {
  profileComplete: boolean;
  teamInvited: boolean;
  hasClient: boolean;
  hasProject: boolean;
  /** A delivery ever started (any state), so the setup ladder can stop asking. */
  hasEngagement: boolean;
  /** A client link was ever minted for a delivery of this studio. */
  hasSharedDelivery: boolean;
  /** The newest delivery still in flight that has no client link yet: where
   *  "Share with your client" opens the link dialog. Null when there is none. */
  newestUnsharedDeliveryId: string | null;
}

interface ProgressRow {
  member_count: number;
  pending: boolean;
  has_client: boolean;
  has_project: boolean;
  has_engagement: boolean;
  has_shared_delivery: boolean;
  newest_unshared_delivery_id: string | null;
}

/**
 * One RLS-scoped round-trip: a batched `exists(...)` per module table. Because
 * every subquery runs under withOrgContext, a flag is true iff a real row exists
 * in THIS org — another org's rows never flip it. `teamInvited` ticks on send
 * (a live pending invite) as well as on accept. A client or project counts only
 * while ACTIVE, matching the pickers the setup ladder sends the studio to (a
 * deactivated client cannot be chosen for a project or a delivery). A delivery
 * counts as shared once it holds a token hash; a revoked link clears the hash,
 * so a studio that revoked every link is asked to share again.
 */
export async function getOnboardingProgress(
  ctx: OrgContext,
  org: Organization,
): Promise<OnboardingProgress> {
  const rows = (await withOrgContext(ctx, (tx) =>
    tx.execute(sql`
      select
        (select count(*)::int from public.memberships) as member_count,
        exists(select 1 from public.invitations where status = 'pending') as pending,
        exists(select 1 from public.clients where active) as has_client,
        exists(select 1 from public.projects where active) as has_project,
        exists(select 1 from public.design_engagements) as has_engagement,
        exists(
          select 1 from public.design_engagements where token_hash is not null
        ) as has_shared_delivery,
        (
          select id from public.design_engagements
          where token_hash is null
            and state not in ('closed_design_only', 'execution', 'abandoned')
          order by created_at desc
          limit 1
        ) as newest_unshared_delivery_id
    `),
  )) as unknown as ProgressRow[] | undefined;
  // The aggregate always yields exactly one row — but an unexpected driver/pooler
  // result shape must degrade to "nothing done yet" (an honest all-false
  // checklist) rather than crash the whole dashboard on `r.member_count`.
  const r = Array.isArray(rows) ? rows[0] : undefined;

  return {
    profileComplete: isProfileComplete(org),
    teamInvited: Number(r?.member_count ?? 0) > 1 || Boolean(r?.pending),
    hasClient: Boolean(r?.has_client),
    hasProject: Boolean(r?.has_project),
    hasEngagement: Boolean(r?.has_engagement),
    hasSharedDelivery: Boolean(r?.has_shared_delivery),
    newestUnsharedDeliveryId:
      typeof r?.newest_unshared_delivery_id === 'string' ? r.newest_unshared_delivery_id : null,
  };
}
