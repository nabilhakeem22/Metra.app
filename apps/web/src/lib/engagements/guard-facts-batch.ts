import 'server-only';
// Design-Engagement Machine — the guard facts of MANY engagements at once, for
// the deliveries list and the dashboard. The same six reads as the executor's
// `loadGuardFacts`, each issued ONCE for the whole batch (`IN (...)`) and
// narrowed to the guard-read columns, so the query count is constant however
// many rows the page shows. Sequential on the
// caller's single transaction, as `loadGuardFacts` is. The result feeds the
// SAME pure `evaluateGatePreview` the cockpit reads, so the list cannot drift
// from the delivery page; a fact a future guard reads must be added here too
// (the batch-vs-single dbtest is what notices if it is not).
import {
  designEngagements,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  paymentEvents,
  type MetraDb,
} from '@metra/db';
import { inArray } from 'drizzle-orm';
import { liveEvents } from './event-provenance';
import type { GuardFacts } from './guards';

// ONLY the columns a guard reads (`GuardFacts` names them), never the evidence
// a client left on a row (IP, user agent, notes, hashes): this read runs for
// every visible delivery on the list and the dashboard.
const GUARD_ENGAGEMENT_COLUMNS = {
  id: designEngagements.id,
  state: designEngagements.state,
  designFee: designEngagements.designFee,
  offPlan: designEngagements.offPlan,
  asBuiltDue: designEngagements.asBuiltDue,
  romLow: designEngagements.romLow,
  romHigh: designEngagements.romHigh,
  romIssuedAt: designEngagements.romIssuedAt,
  titleAr: designEngagements.titleAr,
  titleEn: designEngagements.titleEn,
  clientId: designEngagements.clientId,
  projectId: designEngagements.projectId,
};

const GUARD_EVENT_COLUMNS = {
  engagementId: engagementEvents.engagementId,
  id: engagementEvents.id,
  kind: engagementEvents.kind,
  supersedesEventId: engagementEvents.supersedesEventId,
  decidedAt: engagementEvents.decidedAt,
  createdAt: engagementEvents.createdAt,
  hasVariance: engagementEvents.hasVariance,
  acknowledgedIssueAt: engagementEvents.acknowledgedIssueAt,
  rangeLow: engagementEvents.rangeLow,
  rangeHigh: engagementEvents.rangeHigh,
};

/** Group rows by their engagement id, keeping each group in read order. */
function groupByEngagement<Row extends { engagementId: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.engagementId);
    if (group) group.push(row);
    else groups.set(row.engagementId, [row]);
  }
  return groups;
}

/**
 * The guard facts of every engagement in `engagementIds` that the caller's RLS
 * transaction can see. An empty id list issues no query at all. A foreign or
 * absent id is simply missing from the map.
 */
export async function loadGuardFactsBatch(
  tx: MetraDb,
  engagementIds: readonly string[],
): Promise<Map<string, GuardFacts>> {
  const facts = new Map<string, GuardFacts>();
  if (engagementIds.length === 0) return facts;
  const ids = [...engagementIds];

  const engagements = await tx
    .select(GUARD_ENGAGEMENT_COLUMNS)
    .from(designEngagements)
    .where(inArray(designEngagements.id, ids));
  const milestones = groupByEngagement(
    await tx
      .select({
        engagementId: engagementMilestones.engagementId,
        kind: engagementMilestones.kind,
        basis: engagementMilestones.basis,
        value: engagementMilestones.value,
      })
      .from(engagementMilestones)
      .where(inArray(engagementMilestones.engagementId, ids)),
  );
  const payments = groupByEngagement(
    await tx
      .select({
        engagementId: paymentEvents.engagementId,
        kind: paymentEvents.kind,
        amount: paymentEvents.amount,
      })
      .from(paymentEvents)
      .where(inArray(paymentEvents.engagementId, ids)),
  );
  const artifacts = groupByEngagement(
    await tx
      .select({ engagementId: engagementArtifacts.engagementId, kind: engagementArtifacts.kind })
      .from(engagementArtifacts)
      .where(inArray(engagementArtifacts.engagementId, ids)),
  );
  const changeOrders = groupByEngagement(
    await tx
      .select({
        engagementId: engagementChangeOrders.engagementId,
        status: engagementChangeOrders.status,
        amount: engagementChangeOrders.amount,
      })
      .from(engagementChangeOrders)
      .where(inArray(engagementChangeOrders.engagementId, ids)),
  );
  // LIVE events only, decided per engagement: a correction retracts a row on
  // its own engagement's ledger.
  const events = groupByEngagement(
    await tx
      .select(GUARD_EVENT_COLUMNS)
      .from(engagementEvents)
      .where(inArray(engagementEvents.engagementId, ids)),
  );

  for (const engagement of engagements) {
    facts.set(engagement.id, {
      engagement,
      milestones: milestones.get(engagement.id) ?? [],
      payments: payments.get(engagement.id) ?? [],
      artifacts: artifacts.get(engagement.id) ?? [],
      changeOrders: changeOrders.get(engagement.id) ?? [],
      events: liveEvents(events.get(engagement.id) ?? []),
    });
  }
  return facts;
}
