import { getLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireOrg } from '@/lib/auth/require-org';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { forwardMovesOf } from '@/lib/engagements/command-card';
import { computeCommercialPulse } from '@/lib/engagements/pulse';
import { canRunTrigger, legalTriggersFrom } from '@/lib/engagements/ui';
import { can } from '@/lib/permissions/can';
import { EngagementDetailClient } from './engagement-detail-client';
import {
  deliveryStatusOf,
  engagementCapabilities,
  loadEngagementDetail,
} from './engagement-detail-data';
import { EngagementHeaderCard } from './engagement-header-card';

// AUTHORISE, LOAD, RENDER, and nothing else. The twelve reads and the two
// derivations that need no read are `engagement-detail-data.ts`; the header
// (trail, client link) is `engagement-header-card.tsx`.
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
  // create cell (the same cell that records a payment); the card offers it only then.
  const canResolveClaims = can(ctx.role, 'engagements_finance', 'create');
  // May this role fire the card's forward moves (the forward trigger, or both
  // endings at the choice)? The server action re-checks; this only decides
  // whether to OFFER them.
  const forwardMoves = forwardMovesOf(gatePreview);
  const canAdvance =
    forwardMoves.length > 0 && forwardMoves.every((trigger) => canRunTrigger(ctx.role, trigger));
  const status = deliveryStatusOf({
    header,
    gatePreview,
    pendingClaimCount: paymentClaims.length,
    now: new Date(),
  });

  return (
    <div className="space-y-6">
      <EngagementHeaderCard
        header={header}
        status={status}
        shared={shareStatus.shared}
        canShare={canShare}
        crumbs={{ clientId: header.clientId, clientName, projectId: header.projectId, projectName }}
      />
      {/* KEYED ON THE ENGAGEMENT. Without it a soft navigation between two
          engagements re-renders the same element type at the same position and
          React keeps the subtree alive, so the cockpit's client state — the open
          tab, and the idempotency keys of any attempt still in doubt — carries
          across from the engagement the studio just left. */}
      <EngagementDetailClient
        key={header.id}
        header={header}
        boqStep={data.boqStep}
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
        canStartQuotation={can(ctx.role, 'proposals_build', 'create')}
        gatePreview={gatePreview}
        canAdvance={canAdvance}
        feeSplitPrefill={data.feeSplitPrefill}
        canResolveClaims={canResolveClaims}
        status={status}
        // A pure read-model over the fee schedule + payments already loaded (no
        // extra round trip). Serialized scale-4 strings + an integer percent.
        pulse={computeCommercialPulse({
          feeSchedule: data.feeSchedule,
          payments: data.payments,
          state: header.state,
        })}
        paymentClaims={paymentClaims}
        awaitingReplyCount={data.awaitingReplyCount}
      />
    </div>
  );
}
