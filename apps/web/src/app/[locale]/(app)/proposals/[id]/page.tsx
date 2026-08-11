import { organizations } from '@metra/db';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { listCostItems } from '@/lib/price-book/queries';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { getProposalWithLines } from '@/lib/proposals/queries';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { ProposalBuilder } from './builder-client';

export default async function ProposalBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) notFound();

  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ hide: organizations.hideMarginFromPm })
      .from(organizations)
      .limit(1),
  );
  const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);

  const detail = await getProposalWithLines(ctx, id, seeMargin);
  if (!detail) notFound();
  if (detail.status !== 'draft') redirect(`/proposals/${id}/view`);

  const t = await getTranslations('proposals');
  const costItems = await listCostItems(ctx, { active: true });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${formatProposalNumber(detail.number, proposalYear(detail.issueDate, detail.createdAt))}`}
        description={t('builder.title')}
      />
      <ProposalBuilder
        detail={detail}
        canSend={can(ctx.role, 'proposals_send', 'approve')}
        seeMargin={seeMargin}
        costItems={costItems.map((c) => ({
          id: c.id,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          unit: c.unit,
          defaultUnitCost: c.defaultUnitCost,
          defaultUnitPrice: c.defaultUnitPrice,
        }))}
      />
    </div>
  );
}
