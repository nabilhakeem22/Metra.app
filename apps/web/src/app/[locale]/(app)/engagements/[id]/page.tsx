import { ChevronRight } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
import { computeCommercialPulse } from '@/lib/engagements/pulse';
import {
  getDeliveryShareStatus,
  getEngagementArtifacts,
  getEngagementChangeOrders,
  getEngagementClientActivity,
  getEngagementEvents,
  getEngagementFeeSchedule,
  getEngagementHeader,
  getEngagementPaymentClaims,
  getEngagementPayments,
  getEngagementTransitions,
} from '@/lib/engagements/queries';
import { canRunTrigger, legalTriggersFrom } from '@/lib/engagements/ui';
import { can } from '@/lib/permissions/can';
import { EngagementDetailClient } from './engagement-detail-client';
import { EngagementHeaderCard } from './engagement-header-card';
import { PaymentClaimsPanel } from './payment-claims-panel';
import { DELIVERY_SHARE_ANCHOR_ID } from './share-anchor';
import { DeliveryShareLink } from './share-link';

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

  const tb = await getTranslations('engagements.breadcrumb');
  const locale = await getLocale();
  const clientName =
    pickLocale(
      { nameAr: header.clientNameAr, nameEn: header.clientNameEn },
      'name',
      locale,
    ).value || header.clientId.slice(0, 8);
  const projectName =
    pickLocale(
      { nameAr: header.projectNameAr, nameEn: header.projectNameEn },
      'name',
      locale,
    ).value || header.projectId.slice(0, 8);
  const [
    feeSchedule,
    payments,
    artifacts,
    events,
    changeOrders,
    transitions,
    clientActivity,
    paymentClaims,
    gatePreview,
    shareStatus,
  ] = await Promise.all([
    getEngagementFeeSchedule(ctx, id),
    getEngagementPayments(ctx, id),
    getEngagementArtifacts(ctx, id),
    getEngagementEvents(ctx, id),
    getEngagementChangeOrders(ctx, id),
    getEngagementTransitions(ctx, id),
    getEngagementClientActivity(ctx, id),
    getEngagementPaymentClaims(ctx, id),
    getEngagementGatePreview(ctx, id),
    getDeliveryShareStatus(ctx, id),
  ]);

  // Owner/admin only — the §2.2 `engagements_issue` cell that mints client links.
  const canShare = can(ctx.role, 'engagements_issue', 'approve');
  // The studio resolves client payment claims from the §2.2 `engagements_finance`
  // create cell (the same cell that records a payment); the panel is hidden otherwise.
  const canResolveClaims = can(ctx.role, 'engagements_finance', 'create');

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
    // The staff handoff-ack stand-in only makes sense while the design-only
    // package awaits its receipt — never before, never after closing.
    recordHandoffAck:
      header.state === 'design_only_handoff' &&
      can(ctx.role, 'engagements_design', 'create'),
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
      <nav
        aria-label="breadcrumb"
        className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/clients" className="hover:text-foreground">
          {tb('clients')}
        </Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <Link
          href={`/clients/${header.clientId}`}
          className="hover:text-foreground"
        >
          {clientName}
        </Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <Link
          href={`/projects/${header.projectId}`}
          className="hover:text-foreground"
        >
          {projectName}
        </Link>
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        <span className="text-foreground">{tb('delivery')}</span>
      </nav>
      <EngagementHeaderCard header={header} shared={shareStatus.shared} />
      {canResolveClaims && <PaymentClaimsPanel claims={paymentClaims} />}
      {canShare && (
        <div id={DELIVERY_SHARE_ANCHOR_ID} tabIndex={-1} className="scroll-mt-4 outline-none">
          <DeliveryShareLink
            engagementId={id}
            initialShared={shareStatus.shared}
            canShare={canShare}
          />
        </div>
      )}
      <EngagementDetailClient
        header={header}
        feeSchedule={feeSchedule}
        payments={payments}
        artifacts={artifacts}
        events={events}
        changeOrders={changeOrders}
        transitions={transitions}
        clientActivity={clientActivity}
        nextActions={nextActions}
        capabilities={capabilities}
        canUpload={can(ctx.role, 'engagements_design', 'create')}
        canShare={canShare}
        gatePreview={gatePreview}
        canAdvance={canAdvance}
        stallDays={stallDays}
        pulse={pulse}
        paymentClaimCount={paymentClaims.length}
      />
    </div>
  );
}
