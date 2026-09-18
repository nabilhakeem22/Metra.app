import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/auth/require-org';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { computeCommercialPulse } from '@/lib/engagements/pulse';
import { canRunTrigger, legalTriggersFrom } from '@/lib/engagements/ui';
import { can } from '@/lib/permissions/can';
import { EngagementBreadcrumb } from './engagement-breadcrumb';
import { EngagementDetailClient } from './engagement-detail-client';
import {
  engagementCapabilities,
  loadEngagementDetail,
  stallDaysSince,
} from './engagement-detail-data';
import { EngagementHeaderCard } from './engagement-header-card';
import { PaymentClaimsPanel } from './payment-claims-panel';
import { DELIVERY_SHARE_ANCHOR_ID } from './share-anchor';
import { DeliveryShareLink } from './share-link';

// AUTHORISE, LOAD, RENDER — and nothing else. The twelve reads and the two
// derivations that need no read are `engagement-detail-data.ts`; the trail is
// `engagement-breadcrumb.tsx`. This function was 181 lines, and had GROWN from
// 175 in the very wave that measured it.
export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireOrg();
  if (!can(ctx.role, 'engagements_design', 'read')) notFound();
  const { id } = await params;

  const data = await loadEngagementDetail(ctx, id);
  if (!data) notFound();
  const { header, transitions, gatePreview, shareStatus, paymentClaims } = data;

  const locale = await getLocale();
  const clientName =
    pickLocale({ nameAr: header.clientNameAr, nameEn: header.clientNameEn }, 'name', locale)
      .value || header.clientId.slice(0, 8);
  const projectName =
    pickLocale({ nameAr: header.projectNameAr, nameEn: header.projectNameEn }, 'name', locale)
      .value || header.projectId.slice(0, 8);

  // Owner/admin only — the §2.2 `engagements_issue` cell that mints client links.
  const canShare = can(ctx.role, 'engagements_issue', 'approve');
  // The studio resolves client payment claims from the §2.2 `engagements_finance`
  // create cell (the same cell that records a payment); the panel is hidden otherwise.
  const canResolveClaims = can(ctx.role, 'engagements_finance', 'create');
  // May this role fire the hero's forward-advance trigger? (The server action
  // re-checks — this only decides whether to OFFER the CTA.)
  const canAdvance =
    gatePreview.primaryTrigger !== null && canRunTrigger(ctx.role, gatePreview.primaryTrigger);

  return (
    <div className="space-y-6">
      <EngagementBreadcrumb
        clientId={header.clientId}
        clientName={clientName}
        projectId={header.projectId}
        projectName={projectName}
      />
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
      {/* KEYED ON THE ENGAGEMENT. Without it a soft navigation between two
          engagements re-renders the same element type at the same position and
          React keeps the subtree alive, so the cockpit's client state — the open
          tab, and the idempotency keys of any attempt still in doubt — carries
          across from the engagement the studio just left. */}
      <EngagementDetailClient
        key={header.id}
        header={header}
        boqSummary={data.boqSummary}
        feeSchedule={data.feeSchedule}
        payments={data.payments}
        artifacts={data.artifacts}
        events={data.events}
        changeOrders={data.changeOrders}
        transitions={transitions}
        clientActivity={data.clientActivity}
        nextActions={legalTriggersFrom(header.state).filter((trigger) =>
          canRunTrigger(ctx.role, trigger),
        )}
        capabilities={engagementCapabilities(ctx.role, header.state)}
        canUpload={can(ctx.role, 'engagements_design', 'create')}
        canShare={canShare}
        gatePreview={gatePreview}
        canAdvance={canAdvance}
        stallDays={stallDaysSince(transitions)}
        // A pure read-model over the fee schedule + payments already loaded (no
        // extra round trip). Serialized scale-4 strings + an integer percent.
        pulse={computeCommercialPulse({
          feeSchedule: data.feeSchedule,
          payments: data.payments,
          state: header.state,
        })}
        paymentClaimCount={paymentClaims.length}
        awaitingReplyCount={data.awaitingReplyCount}
      />
    </div>
  );
}
