import 'server-only';
// EVERY READ THE COCKPIT PAGE MAKES, AND THE TWO DERIVATIONS THAT NEED NO READ.
//
// Split out of `page.tsx`, whose component was 181 lines — over the 120 the
// wave-5 gate asked for, and GROWN from 175 by the wave it was measured in.
// `page.tsx` is now the three things a route ought to be: authorise, load,
// render. Nothing here renders and nothing here decides layout.
//
// A plain server module, not 'use client' and not a component: the page names
// what it is assembling, exactly as `engagement-detail-props.ts` lets it name
// what it is handing on.
import type { MemberRole } from '@metra/db';
import { getProjectBoqSummary } from '@/lib/boqs/queries';
import type { OrgContext } from '@/lib/db/context';
import { countAwaitingReplyCore } from '@/lib/engagements/document-comments';
import { getEngagementGatePreview } from '@/lib/engagements/gate-preview';
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
  type EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { can } from '@/lib/permissions/can';
import type { PanelCapabilities } from './engagement-panels';

export type EngagementDetailData = NonNullable<
  Awaited<ReturnType<typeof loadEngagementDetail>>
>;

/**
 * The header first (it decides whether the route is a 404 at all), then every
 * other read in ONE `Promise.all` — eleven round trips that do not depend on
 * each other and must not become eleven sequential waits.
 *
 * The BOQ summary is the one read that CANNOT join that batch: it is keyed on
 * `header.projectId`, so it has to follow the header. It used to be awaited
 * inline in the page's JSX, which is a sequential read hidden inside a render.
 */
export async function loadEngagementDetail(ctx: OrgContext, id: string) {
  const header = await getEngagementHeader(ctx, id);
  if (!header) return null;

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
    awaitingReplyCount,
    boqSummary,
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
    // Client Deliverables Step 2 — how many client questions are still unanswered.
    // Derived from the append-only thread (a client message with no staff message
    // after it), so it falls when the studio REPLIES, not when it opens a thread.
    countAwaitingReplyCore(ctx, id),
    getProjectBoqSummary(ctx, header.projectId),
  ]);

  return {
    header,
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
    awaitingReplyCount,
    boqSummary,
  };
}

/**
 * Which cockpit controls this role is even OFFERED. Every one of these is
 * re-checked by the server action it guards; this decides what is on screen.
 */
export function engagementCapabilities(
  role: MemberRole,
  state: string,
): PanelCapabilities {
  return {
    recordPayment: can(role, 'engagements_finance', 'create'),
    recordArtifact: can(role, 'engagements_design', 'create'),
    setRom: can(role, 'engagements_design', 'update'),
    // Issuing the band is OWNER/ADMIN only, deliberately narrower than setting
    // it: typing a working range is routine studio work, putting a cost figure
    // in front of the end client is not.
    issueRom: can(role, 'engagements_issue', 'approve'),
    recordRomAck: can(role, 'engagements_design', 'create'),
    // The staff handoff-ack stand-in only makes sense while the design-only
    // package awaits its receipt — never before, never after closing.
    recordHandoffAck:
      state === 'design_only_handoff' && can(role, 'engagements_design', 'create'),
    // Retracting a ledger row is OWNER/ADMIN only, deliberately narrower than the
    // create gate on the acknowledgements themselves: recording what a client
    // said is routine studio work, unsaying it afterwards is not.
    retract: can(role, 'engagements_issue', 'approve'),
  };
}

/**
 * Days since the newest transition (transitions are newest-first). Computed on
 * the SERVER so the hero renders a stable value with no Date/hydration drift and
 * no Arabic-Indic digits.
 */
export function stallDaysSince(
  transitions: EngagementTransitionRecord[],
): number | null {
  const latest = transitions[0]?.decidedAt ?? null;
  if (!latest) return null;
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000),
  );
}
