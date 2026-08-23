import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import {
  getEngagementArtifacts,
  getEngagementChangeOrders,
  getEngagementEvents,
  getEngagementFeeSchedule,
  getEngagementHeader,
  getEngagementPayments,
  getEngagementTransitions,
} from '@/lib/engagements/queries';
import { canRunTrigger, legalTriggersFrom } from '@/lib/engagements/ui';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { can } from '@/lib/permissions/can';
import { EngagementDetailClient } from './engagement-detail-client';

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'engagements_design', 'read')) notFound();
  const { id } = await params;

  const header = await getEngagementHeader(ctx, id);
  if (!header) notFound();

  const t = await getTranslations('engagements');
  const [feeSchedule, payments, artifacts, events, changeOrders, transitions] =
    await Promise.all([
      getEngagementFeeSchedule(ctx, id),
      getEngagementPayments(ctx, id),
      getEngagementArtifacts(ctx, id),
      getEngagementEvents(ctx, id),
      getEngagementChangeOrders(ctx, id),
      getEngagementTransitions(ctx, id),
    ]);

  const nextActions = legalTriggersFrom(header.state).filter((trigger) =>
    canRunTrigger(ctx.role, trigger),
  );
  const capabilities = {
    recordPayment: can(ctx.role, 'engagements_finance', 'create'),
    recordArtifact: can(ctx.role, 'engagements_design', 'create'),
    setRom: can(ctx.role, 'engagements_design', 'update'),
    recordRomAck: can(ctx.role, 'engagements_design', 'create'),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={formatDocNumber('DE', header.number, docYear(null, header.createdAt))}
        description={t('subtitle')}
      />
      <EngagementDetailClient
        header={header}
        feeSchedule={feeSchedule}
        payments={payments}
        artifacts={artifacts}
        events={events}
        changeOrders={changeOrders}
        transitions={transitions}
        nextActions={nextActions}
        capabilities={capabilities}
      />
    </div>
  );
}
