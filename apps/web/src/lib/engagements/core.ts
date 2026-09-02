// Engagement-core create for the Design-Engagement Machine (Step 1). This slice
// is deliberately small: it validates the header, allocates the per-org DE
// number and inserts ONE row in state `created`. The transition registry, guard
// engine and executor are Step 2 — nothing here writes engagement_transitions or
// moves state off `created`.
import { clients, designEngagements, projects } from '@metra/db';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { normalizeText } from '@/lib/proposals/core';
import { ACTIVE_STATES } from './states';
import { isUuid } from '@/lib/uuid';

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

// Postgres unique-violation SQLSTATE + the one-active-delivery backstop index
// (migration 0032). A 23505 on THIS named index means a concurrent create won the
// race for the project's single active slot — map it to the friendly
// `project_delivery_exists`. Any other 23505 (or a missing constraint name)
// rethrows so it surfaces as `generic` rather than being silently misreported.
const UNIQUE_VIOLATION = '23505';
const ONE_ACTIVE_INDEX = 'design_engagements_one_active_per_project_uniq';

function isActiveDeliveryConflict(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === UNIQUE_VIOLATION &&
    (e as { constraint_name?: string }).constraint_name === ONE_ACTIVE_INDEX
  );
}

export interface CreateEngagementInput {
  titleAr?: string | null;
  titleEn?: string | null;
  clientId: string;
  projectId: string;
  offPlan?: boolean;
}

/**
 * Create a design engagement in state `created`. Title is bilingual (at least one
 * of ar/en); client + project must both resolve in-org (RLS scopes the reads and
 * the composite same-org FKs are the hard guard). Allocates the per-org DE number
 * under an advisory lock so concurrent creates never collide on
 * unique(org_id, number). Returns the new engagement id.
 */
export async function createEngagementCore(
  ctx: OrgContext,
  input: CreateEngagementInput,
): Promise<ActionResult> {
  const clientId = input.clientId?.trim();
  const projectId = input.projectId?.trim();
  const titleAr = normalizeText(input.titleAr);
  const titleEn = normalizeText(input.titleEn);
  if (!titleAr && !titleEn) return err('engagement_title_required');
  if (!clientId || !isUuid(clientId)) {
    return err('engagement_client_required');
  }
  if (!projectId || !isUuid(projectId)) {
    return err('engagement_project_required');
  }

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'create', flow: 'interior' },
    async (tx, audit) => {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client) fail('engagement_client_required');
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) fail('engagement_project_required');

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

      const number = await allocateNumber(
        tx,
        ctx.orgId,
        'design_engagement',
        'design_engagements',
        'number',
      );

      // The INSERT can still race the read-guard above: two concurrent creates on
      // an empty project both pass the read, both allocate a number, then contend
      // on the one-active-per-project unique index (0032). The loser's 23505 on
      // THAT index maps to `project_delivery_exists`; anything else rethrows ->
      // mutateInOrg -> generic.
      let row: { id: string };
      try {
        [row] = await tx
          .insert(designEngagements)
          .values({
            orgId: ctx.orgId,
            number,
            titleAr,
            titleEn,
            clientId,
            projectId,
            state: 'created',
            offPlan: input.offPlan ?? false,
          })
          .returning({ id: designEngagements.id });
      } catch (e) {
        if (isActiveDeliveryConflict(e)) return fail('project_delivery_exists');
        throw e;
      }

      await audit({
        entity: 'design_engagement',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { number, client_id: clientId, project_id: projectId },
      });
      return row.id;
    },
  );
}
