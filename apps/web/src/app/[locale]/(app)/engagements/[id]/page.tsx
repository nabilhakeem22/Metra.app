import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { computeCommercialPulse } from '@/lib/engagements/pulse';
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
  const [
    feeSchedule,
    payments,
    artifacts,
    events,
    changeOrders,
    transitions,
    gatePreview,
  ] = await Promise.all([
    getEngagementFeeSchedule(ctx, id),
    getEngagementPayments(ctx, id),
    getEngagementArtifacts(ctx, id),
    getEngagementEvents(ctx, id),
    getEngagementChangeOrders(ctx, id),
    getEngagementTransitions(ctx, id),
    getEngagementGatePreview(ctx, id),
  ]);

  // The commercial pulse: a pure read-model over the fee schedule + payments the
  // page has ALREADY loaded (no extra DB round-trip). Serialized scale-4 strings +
  // an integer percent cross to the client bar.
  const pulse = computeCommercialPulse({
    feeSchedule,
    payments,
    state: header.state,
  });

  const nextActions = legalTriggersFrom(header.state).filter((trigger) =>
    canRunTrigger(ctx.role, trigger),
  );
  const capabilities = {
    recordPayment: can(ctx.role, 'engagements_finance', 'create'),
    recordArtifact: can(ctx.role, 'engagements_design', 'create'),
    setRom: can(ctx.role, 'engagements_design', 'update'),
    recordRomAck: can(ctx.role, 'engagements_design', 'create'),
  };

  // May this role fire the hero's forward-advance trigger? (The server action
  // re-checks — this only decides whether to OFFER the CTA.)
  const canAdvance =
    gatePreview.primaryTrigger !== null &&
    canRunTrigger(ctx.role, gatePreview.primaryTrigger);

  // Days since the newest transition (transitions are newest-first). Computed on
  // the server so the client hero renders a stable value with no Date/hydration
  // drift and no Arabic-Indic digits.
  const latestTransitionAt = transitions[0]?.decidedAt ?? null;
  const stallDays = latestTransitionAt
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(latestTransitionAt).getTime()) / 86_400_000,
        ),
      )
    : null;

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
        gatePreview={gatePreview}
        canAdvance={canAdvance}
        stallDays={stallDays}
        pulse={pulse}
      />
    </div>
  );
}
