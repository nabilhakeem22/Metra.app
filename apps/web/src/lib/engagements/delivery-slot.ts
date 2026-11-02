// Is there room for a delivery of this client on this project? The read-guards
// of `createEngagementCore`, run AFTER its allocateNumber: that per-org lock also
// serialises the light insert (lib/client-home/ensure.ts), so the two insert
// sites read each other's rows. Code-level guards, RLS-scoped; the
// one-active-per-project unique index (0032) is the backstop for the race
// between two creates, and stays in the core.
import { designEngagements, type MetraDb } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { failFields } from '@/lib/actions/field-errors';
import { deliveryDocumentNumber } from './design-first';
import type { ProjectClient } from './pair-home';
import { isTerminal } from './states';

/**
 * Refuses under the project select: `project_delivery_exists` when the project
 * holds an in-flight delivery of any client, and `project_client_has_delivery`
 * when this client has any delivery on it but an abandoned one: a client on a
 * project has one delivery, so one link (design-first.ts). Writes nothing.
 */
export async function assertProjectHasDeliverySlot(tx: MetraDb, pair: ProjectClient): Promise<void> {
  const deliveries = await tx
    .select({
      number: designEngagements.number,
      createdAt: designEngagements.createdAt,
      state: designEngagements.state,
      clientId: designEngagements.clientId,
    })
    .from(designEngagements)
    .where(and(eq(designEngagements.projectId, pair.projectId), ne(designEngagements.state, 'abandoned')));
  if (deliveries.some((delivery) => !isTerminal(delivery.state))) {
    failFields({ projectId: { code: 'project_delivery_exists' } });
  }
  const own = deliveries.find((delivery) => delivery.clientId === pair.clientId);
  if (own) {
    failFields({ projectId: { code: 'project_client_has_delivery', params: { delivery: deliveryDocumentNumber(own) } } });
  }
}
