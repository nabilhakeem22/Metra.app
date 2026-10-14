// Engagement-core create for the Design-Engagement Machine (Step 1). This slice
// is deliberately small: it validates the header, allocates the per-org DE
// number and inserts ONE row in state `created`. The transition registry, guard
// engine and executor are Step 2 — nothing here writes engagement_transitions or
// moves state off `created`.
import { designEngagements } from '@metra/db';
import { failFields, fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';
import { isUuid } from '@/lib/uuid';
import { requireChosenClient, requireChosenProject } from './create-choices';
import { engagementCreateFieldErrors } from './create-field-rules';
import { assertProjectHasDeliverySlot } from './delivery-slot';

/**
 * The races the reads below can lose, each under the select it is about. The
 * one-active-delivery backstop index (migration 0032): a concurrent create won
 * the project's single active slot, the same answer the read-guard gives. The
 * composite same-org FKs: the client or project was deleted between the read
 * and the insert. Any other 23505 stays in the logged tail.
 */
const CREATE_REFUSALS = [
  {
    constraint: 'design_engagements_one_active_per_project_uniq',
    field: 'projectId',
    error: { code: 'project_delivery_exists' },
  },
  {
    constraint: 'design_engagements_client_same_org_fk',
    field: 'clientId',
    error: { code: 'no_longer_exists' },
  },
  {
    constraint: 'design_engagements_project_same_org_fk',
    field: 'projectId',
    error: { code: 'no_longer_exists' },
  },
] as const satisfies readonly ConstraintRefusal[];

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
  const choiceErrors = engagementCreateFieldErrors(input);
  if (hasFieldErrors(choiceErrors)) return fieldsFailed(choiceErrors);
  const clientId = input.clientId.trim();
  const projectId = input.projectId.trim();
  const typedTitleAr = clean(input.titleAr);
  const typedTitleEn = clean(input.titleEn);
  // An id no select can send: the shape is wrong, not the choice.
  if (!isUuid(clientId)) return err('engagement_client_required');
  if (!isUuid(projectId)) return err('engagement_project_required');

  return mutateInOrg(
    ctx,
    {
      capability: 'engagements_design',
      action: 'create',
      flow: 'interior',
      refusals: CREATE_REFUSALS,
    },
    async (tx, audit) => {
      // Existence assertions, not reads: the call IS the check, and it refuses
      // under the select if the id belongs to another tenant or to nothing.
      await requireChosenClient(tx, clientId);
      const project = await requireChosenProject(tx, projectId);
      const typedAnyTitle = Boolean(typedTitleAr || typedTitleEn);
      const titleAr = typedAnyTitle ? typedTitleAr : clean(project.nameAr);
      const titleEn = typedAnyTitle ? typedTitleEn : clean(project.nameEn);
      if (!titleAr && !titleEn) failFields({ title: { code: 'engagement_title_required' } });

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
      // on the one-active-per-project unique index (0032); `refusals` answers the
      // loser.
      const [row] = await tx
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
