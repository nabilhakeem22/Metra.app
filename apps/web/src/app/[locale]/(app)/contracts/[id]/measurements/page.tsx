import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BackToSiteAppLink } from '@/components/site/back-to-site-app-link';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { mayReadMeasurements, mayRecordMeasurements } from '@/lib/execution/measurements/access';
import { getMeasurementContract } from '@/lib/execution/measurements/contract-view';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { isUuid } from '@/lib/uuid';
import { MeasurementsPageClient } from './measurements-page-client';

/**
 * Site measurements (plan A5.1): the page the site engineer and the project
 * manager reach from the delivery's execution card ("Record measurements").
 * Gated on the `site_measurements` row, NOT on the contract page
 * (`contracts_generate`), so it shows the contract's number, title, client and
 * status and nothing of its money. The lines ask for themselves when it opens,
 * 50 at a time, so the page costs the same however long the contract is.
 */
export default async function ContractMeasurementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const ctx = await requireOrg();
  if (!mayReadMeasurements(ctx.role)) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const header = await getMeasurementContract(ctx, id);
  if (!header) notFound();
  const t = await getTranslations('contracts.execution.measurements.page');

  return (
    <div className="space-y-6">
      <BackToSiteAppLink from={(await searchParams).from} />
      <PageHeader title={t('title', { number: formatDocNumber('C', header.number, docYear(null, header.createdAt)) })} description={t('subtitle')} />
      <MeasurementsPageClient header={header} canRecord={mayRecordMeasurements(ctx.role)} />
    </div>
  );
}
