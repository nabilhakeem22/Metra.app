// Engagement-core create for the Design-Engagement Machine (Step 1). This slice
// is deliberately small: it validates the header, allocates the per-org DE
// number and inserts ONE row in state `created`. The transition registry, guard
// engine and executor are Step 2 — nothing here writes engagement_transitions or
// moves state off `created`.
import { clients, designEngagements, projects } from '@metra/db';
import { driverRefusalOf } from '@metra/db/sqlstate';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';
import { isUuid } from '@/lib/uuid';
import { assertProjectHasDeliverySlot } from './delivery-slot';

// Postgres unique-violation SQLSTATE + the one-active-delivery backstop index
// (migration 0032). A 23505 on THIS named index means a concurrent create won the
// race for the project's single active slot — map it to the friendly
// `project_delivery_exists`. Any other 23505 (or a missing constraint name)
// rethrows so it surfaces as `generic` rather than being silently misreported.
// Both reads come off ONE object: this insert runs through the ORM, so from
// drizzle 0.44 the SQLSTATE and the constraint name sit one level down the
// `cause` chain — and asking for them separately would let them answer from two
// different levels, pairing a code from one error with a name from another.
const UNIQUE_VIOLATION = '23505';
const ONE_ACTIVE_INDEX = 'design_engagements_one_active_per_project_uniq';

function isActiveDeliveryConflict(e: unknown): boolean {
  const refusal = driverRefusalOf(e);
  return (
    refusal?.code === UNIQUE_VIOLATION && refusal.constraintName === ONE_ACTIVE_INDEX
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
 * Create a design engagement in state `created`. Title is bilingual; when both are
 * left empty the delivery takes its project's names (the form says so), and
 * `engagement_title_required` is returned only when the project has none either.
 * Client + project must both resolve in-org (RLS scopes the reads and the
 * composite same-org FKs are the hard guard). Allocates the per-org DE number
 * under an advisory lock so concurrent creates never collide on
 * unique(org_id, number). Returns the new engagement id.
 */
export async function createEngagementCore(
  ctx: OrgContext,
  input: CreateEngagementInput,
): Promise<ActionResult> {
  const clientId = input.clientId?.trim();
  const projectId = input.projectId?.trim();
  const typedTitleAr = clean(input.titleAr);
  const typedTitleEn = clean(input.titleEn);
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
      // Existence assertions, not reads: the call IS the check, and it fails with
      // a coded error if the id belongs to another tenant or to nothing.
      await requireInOrg(tx, clients, clientId, { id: clients.id }, 'engagement_client_required');
      const project = await requireInOrg(
        tx,
        projects,
        projectId,
        { id: projects.id, nameAr: projects.nameAr, nameEn: projects.nameEn },
        'engagement_project_required',
      );
      const typedAnyTitle = Boolean(typedTitleAr || typedTitleEn);
      const titleAr = typedAnyTitle ? typedTitleAr : clean(project.nameAr);
      const titleEn = typedAnyTitle ? typedTitleEn : clean(project.nameEn);
      if (!titleAr && !titleEn) fail('engagement_title_required');

      await assertProjectHasDeliverySlot(tx, projectId);

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
