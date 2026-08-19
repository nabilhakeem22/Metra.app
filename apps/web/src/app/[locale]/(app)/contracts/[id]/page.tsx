import { organizations } from '@metra/db';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getContractWithLines } from '@/lib/contracts/queries';
import { withOrgContext } from '@/lib/db/context';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { can, canSeeMargin } from '@/lib/permissions/can';
import { listVariations } from '@/lib/variations/queries';
import { eq } from 'drizzle-orm';
import { ContractDetailClient } from './contract-detail-client';

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'contracts_generate', 'read')) notFound();
  const { id } = await params;

  const t = await getTranslations('contracts');
  const [org] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ hide: organizations.hideMarginFromPm })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1),
  );
  const seeMargin = canSeeMargin(ctx.role, org?.hide ?? true);
  const detail = await getContractWithLines(ctx, id, seeMargin);
  if (!detail) notFound();
  const variations = await listVariations(ctx, { contractId: id });

  const canManage = can(ctx.role, 'contracts_generate', 'update');
  const canIssue = can(ctx.role, 'contracts_issue', 'approve');
  const canDraftVariation = can(ctx.role, 'variations_draft', 'create');
  const canPriceVariation = can(ctx.role, 'variations_price', 'approve');

  return (
    <div className="space-y-6">
      <PageHeader
        title={formatDocNumber('C', detail.number, docYear(null, detail.createdAt))}
        description={t('subtitle')}
      />
      <ContractDetailClient
        detail={detail}
        variations={variations}
        canManage={canManage}
        canIssue={canIssue}
        canDraftVariation={canDraftVariation}
        canPriceVariation={canPriceVariation}
      />
    </div>
  );
}
