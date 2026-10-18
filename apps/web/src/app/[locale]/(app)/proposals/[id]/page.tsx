import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getEngagementBoqReleasable } from '@/lib/engagements/queries';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { hasActiveCostItem } from '@/lib/price-book/picker-query';
import { getProposalWithLines } from '@/lib/proposals/queries';
import { listSections } from '@/lib/sections/queries';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { ProposalBuilder, type BoqModeProps } from './builder-client';

export default async function ProposalBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireOrg();
  if (!can(ctx.role, 'proposals_build', 'read')) notFound();

  const seeMargin = await resolveSeeMargin(ctx);

  const detail = await getProposalWithLines(ctx, id, seeMargin);
  if (!detail) notFound();
  if (detail.status !== 'draft') redirect(`/proposals/${id}/view`);

  const t = await getTranslations('proposals');
  // The picker asks for its items when it opens; the page only says there are any,
  // and only to a role that may edit the draft (a reader cannot add a line).
  const hasPriceBook = can(ctx.role, 'proposals_build', 'update') && (await hasActiveCostItem(ctx));
  const sectionLibrary = await listSections(ctx);

  // BOQ mode is decided HERE, from the row, never from the URL. Its Q- number is
  // never rendered: the header is the document's name instead.
  const boqMode: BoqModeProps | null =
    detail.kind === 'boq' && detail.engagementId
      ? {
          engagementId: detail.engagementId,
          clientCanOpenNow: await getEngagementBoqReleasable(ctx, detail.engagementId),
          canSend: can(ctx.role, 'boq_build', 'create'),
        }
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          boqMode
            ? t('boqMode.title')
            : formatProposalNumber(detail.number, proposalYear(detail.issueDate, detail.createdAt))
        }
        description={boqMode ? undefined : t('builder.title')}
      />
      <ProposalBuilder
        detail={detail}
        boqMode={boqMode}
        canSend={can(ctx.role, 'proposals_send', 'approve')}
        seeMargin={seeMargin}
        hasPriceBook={hasPriceBook}
        sectionLibrary={sectionLibrary.map((s) => ({
          id: s.id,
          nameEn: s.nameEn,
          nameAr: s.nameAr,
        }))}
      />
    </div>
  );
}
