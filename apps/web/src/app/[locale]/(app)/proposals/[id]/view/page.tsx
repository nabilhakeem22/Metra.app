import { organizations } from '@metra/db';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { getProposalWithLines } from '@/lib/proposals/queries';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { ProposalView } from './view-client';

export default async function ProposalViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) notFound();

  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select({ hide: organizations.hideMarginFromPm }).from(organizations).limit(1),
  );
  const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);

  const detail = await getProposalWithLines(ctx, id, seeMargin);
  if (!detail) notFound();
  if (detail.status === 'draft') redirect(`/proposals/${id}`);

  const t = await getTranslations('proposals');
  return (
    <div className="space-y-6">
      <PageHeader
        title={formatProposalNumber(detail.number, proposalYear(detail.issueDate, detail.createdAt))}
        description={t('view.title')}
      />
      <ProposalView
        detail={detail}
        seeMargin={seeMargin}
        canSupersede={can(ctx.role, 'proposals_build', 'create')}
        canExpire={can(ctx.role, 'proposals_send', 'approve')}
      />
    </div>
  );
}
