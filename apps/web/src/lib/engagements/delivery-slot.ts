// Does this project have room for another delivery? Extracted verbatim from
// `createEngagementCore` (round A1): the two read-guards that run inside the
// create transaction BEFORE a document number is spent. Code-level guards,
// RLS-scoped; the one-active-per-project unique index (0032) is the backstop
// for the race between them and the insert, and stays in the core.
import { designEngagements, type MetraDb } from '@metra/db';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { ACTIVE_STATES } from './states';

// The non-terminal (in-flight) states a Delivery can occupy — materialized once for
// the one-delivery-per-project guard's `state IN (…)` probe. A Delivery in a
// TERMINAL state (closed_design_only / execution / abandoned) has left its Project
// and does NOT block a fresh start.
const ACTIVE_ENGAGEMENT_STATES = [...ACTIVE_STATES];

// Lifetime cap: a Project may hold at most TWO NON-abandoned deliveries over its
// life (the original + one extension). Abandoned deliveries are ignored by the
// count (owner decision) — a project with 1 real + N abandoned rows can still
// start its extension.
const PROJECT_DELIVERY_CAP = 2;

/**
 * Throws `project_delivery_exists` when the project already holds an in-flight
 * delivery, and `project_delivery_limit_reached` when it has used its two
 * non-abandoned deliveries. Writes nothing.
 */
export async function assertProjectHasDeliverySlot(
  tx: MetraDb,
  projectId: string,
): Promise<void> {
  // One-delivery-per-project guard (Slice C2): a Project may hold at most one
  // in-flight Delivery. If a non-terminal row already exists for this project,
  // refuse before allocating a number so nothing is written. TERMINAL deliveries
  // (closed_design_only / execution / abandoned) do not block a fresh start.
  // Code-level guard, RLS-scoped — no DB constraint.
  const [existing] = await tx
    .select({ id: designEngagements.id })
    .from(designEngagements)
    .where(
      and(
        eq(designEngagements.projectId, projectId),
        inArray(designEngagements.state, ACTIVE_ENGAGEMENT_STATES),
      ),
    )
    .limit(1);
  if (existing) fail('project_delivery_exists');

  // Lifetime cap (Slice C2-hardening): at most TWO NON-abandoned deliveries per
  // project (original + one extension). Abandoned rows do NOT count toward the
  // cap (owner decision — predicate `state <> 'abandoned'`), so a project with 1
  // real + N abandoned deliveries can still start its extension. Checked BEFORE
  // allocating a number so a rejected create writes nothing and spends none.
  const [{ value: countedDeliveries }] = await tx
    .select({ value: count() })
    .from(designEngagements)
    .where(
      and(
        eq(designEngagements.projectId, projectId),
        ne(designEngagements.state, 'abandoned'),
      ),
    );
  if (countedDeliveries >= PROJECT_DELIVERY_CAP) {
    fail('project_delivery_limit_reached');
  }
}
