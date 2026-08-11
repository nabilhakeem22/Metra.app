import 'server-only';
import type { Organization } from '@metra/db';
import { sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isProfileComplete } from '@/lib/org/profile';

export interface OnboardingProgress {
  profileComplete: boolean;
  teamInvited: boolean;
  hasCostItem: boolean;
  hasClient: boolean;
  hasProject: boolean;
  hasProposal: boolean;
  hasSentProposal: boolean;
}

interface ProgressRow {
  member_count: number;
  pending: boolean;
  has_cost_item: boolean;
  has_client: boolean;
  has_project: boolean;
  has_proposal: boolean;
  has_sent_proposal: boolean;
}

/**
 * One RLS-scoped round-trip: a batched `exists(...)` per module table. Because
 * every subquery runs under withOrgContext, a flag is true iff a real row exists
 * in THIS org — another org's rows never flip it. `teamInvited` ticks on send
 * (a live pending invite) as well as on accept.
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
        exists(select 1 from public.cost_items) as has_cost_item,
        exists(select 1 from public.clients) as has_client,
        exists(select 1 from public.projects) as has_project,
        exists(select 1 from public.proposals) as has_proposal,
        exists(
          select 1 from public.proposals
          where status in ('sent','accepted','rejected','expired','superseded')
        ) as has_sent_proposal
    `),
  )) as unknown as ProgressRow[];
  const r = rows[0];

  return {
    profileComplete: isProfileComplete(org),
    teamInvited: Number(r.member_count) > 1 || Boolean(r.pending),
    hasCostItem: Boolean(r.has_cost_item),
    hasClient: Boolean(r.has_client),
    hasProject: Boolean(r.has_project),
    hasProposal: Boolean(r.has_proposal),
    hasSentProposal: Boolean(r.has_sent_proposal),
  };
}
