import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getContractIdForProposal } from '@/lib/contracts/queries';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
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

  const seeMargin = await resolveSeeMargin(ctx);

  const detail = await getProposalWithLines(ctx, id, seeMargin);
  if (!detail) notFound();
  if (detail.status === 'draft') redirect(`/proposals/${id}`);

  // Contract generation entry point (mirrors the contracts-list picker): only an
  // accepted proposal, and we surface either "generate" or a link to the existing
  // contract so it can't be double-generated.
  const existingContractId =
    detail.status === 'accepted'
      ? await getContractIdForProposal(ctx, id)
      : null;
  const canGenerateContract =
    detail.status === 'accepted' && can(ctx.role, 'contracts_generate', 'create');

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
        canGenerateContract={canGenerateContract}
        existingContractId={existingContractId}
      />
    </div>
  );
}
