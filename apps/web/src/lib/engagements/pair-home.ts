// The design-first rule (./design-first.ts) read inside the caller's
// transaction: one statement, RLS-scoped, so another org's pair reads as empty.
// Every core that could start execution asks here, and nothing else decides.
import { designEngagements, type MetraDb } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { fail } from '@/lib/actions/mutate';
import { designFirstTargetFor, executionGateOf, type ExecutionGate, type PairDelivery } from './design-first';
import { entryPhaseOf } from './queries/entry-phase';

export interface ProjectClient {
  projectId: string;
  clientId: string;
}

/** The pair's deliveries that are not abandoned. */
export async function readPairDeliveries(tx: MetraDb, pair: ProjectClient): Promise<PairDelivery[]> {
  const rows = await tx
    .select({
      id: designEngagements.id,
      number: designEngagements.number,
      createdAt: designEngagements.createdAt,
      state: designEngagements.state,
      entryPhase: designEngagements.entryPhase,
    })
    .from(designEngagements)
    .where(
      and(
        eq(designEngagements.projectId, pair.projectId),
        eq(designEngagements.clientId, pair.clientId),
        ne(designEngagements.state, 'abandoned'),
      ),
    );
  return rows.map((row) => ({ ...row, entryPhase: entryPhaseOf(row.entryPhase) }));
}

export async function readExecutionGate(tx: MetraDb, pair: ProjectClient): Promise<ExecutionGate> {
  return executionGateOf(await readPairDeliveries(tx, pair));
}

/** Refuses while design runs or stands closed on the pair; answers the gate otherwise. */
export async function requireDesignFinished(
  tx: MetraDb,
  pair: ProjectClient,
): Promise<Extract<ExecutionGate, { kind: 'home' | 'no_delivery' }>> {
  const gate = await readExecutionGate(tx, pair);
  if (gate.kind === 'design_open' || gate.kind === 'design_only_closed') fail(gate.kind, designFirstTargetFor(gate.delivery));
  return gate;
}

/**
 * For a contract from a proposal: a pair with a delivery gets its contract from
 * that delivery's BOQ, on the one link, never beside it. With no delivery, a
 * proposal contract stands as it always has.
 */
export async function requirePairWithoutDelivery(tx: MetraDb, pair: ProjectClient): Promise<void> {
  const gate = await requireDesignFinished(tx, pair);
  if (gate.kind === 'home') fail('contract_from_boq_only', designFirstTargetFor(gate.delivery));
}
