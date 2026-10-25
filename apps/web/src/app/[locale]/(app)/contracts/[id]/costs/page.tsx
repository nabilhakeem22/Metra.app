import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BackToSiteAppLink } from '@/components/site/back-to-site-app-link';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { costEntriesScopeFor, mayReadCostEntries, mayRecordCostEntries } from '@/lib/execution/costs/access';
import { getCostContractHeader } from '@/lib/execution/costs/contract-view';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { resolveSeeMargin } from '@/lib/org/queries';
import { can } from '@/lib/permissions/can';
import { isUuid } from '@/lib/uuid';
import { CostsPageClient } from './costs-page-client';

/**
 * Recording costs (lead ruling on PR B3, F1): the page project managers, site
 * engineers and accountants reach from the delivery's execution card. It is
 * gated on reading costs, NOT on the contract page (`contracts_generate`), so
 * it shows the contract's number, title, client and status and nothing of its
 * money: no value, no totals of the contract, no margin. The costs list asks
 * for itself when it opens, so the page costs the same however many costs the
 * contract holds. A member who may not see margin lists only the costs it
 * recorded, with no total (owner ruling, Oct 21), and the subtitle says so.
 */
export default async function ContractCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const ctx = await requireOrg();
  if (!mayReadCostEntries(ctx.role)) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const header = await getCostContractHeader(ctx, id);
  if (!header) notFound();
  const t = await getTranslations('contracts.costs');
  const ownOnly = costEntriesScopeFor(await resolveSeeMargin(ctx)) === 'own';

  return (
    <div className="space-y-6">
      <BackToSiteAppLink from={(await searchParams).from} />
      <PageHeader title={t('page.title', { number: formatDocNumber('C', header.number, docYear(null, header.createdAt)) })} description={t(ownOnly ? 'page.subtitleOwn' : 'page.subtitle')} />
      <CostsPageClient
        header={header}
        canCreate={mayRecordCostEntries(ctx.role)}
        canPickCostItem={can(ctx.role, 'proposals_build', 'update')}
      />
    </div>
  );
}
