// Engagement-core create for the Design-Engagement Machine (Step 1). This slice
// is deliberately small: it validates the header, allocates the per-org DE
// number and inserts ONE row in state `created`. The transition registry, guard
// engine and executor are Step 2 — nothing here writes engagement_transitions or
// moves state off `created`.
import { designEngagements, type MetraDb } from '@metra/db';
import { failFields, fieldsFailed, hasFieldErrors } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { AuditEntry } from '@/lib/audit';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';
import { isUuid } from '@/lib/uuid';
import { requireChosenClient, requireChosenProject } from './create-choices';
import { engagementCreateFieldErrors } from './create-field-rules';
import { titlesForNewEngagement } from './create-fields';
import { CREATE_REFUSALS } from './create-refusals';
import { assertProjectHasDeliverySlot } from './delivery-slot';

export interface CreateEngagementInput {
  titleAr?: string | null;
  titleEn?: string | null;
  clientId: string;
  projectId: string;
  offPlan?: boolean;
}

interface NewEngagementRow {
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  offPlan: boolean;
}

/** Inserts the delivery row in state `created` and audits it; answers its id. */
async function insertCreatedEngagement(
  tx: MetraDb,
  ctx: OrgContext,
  engagement: NewEngagementRow,
  audit: (entry: AuditEntry) => Promise<void>,
): Promise<string> {
  const { number, titleAr, titleEn, clientId, projectId, offPlan } = engagement;
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
      offPlan,
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
      const { titleAr, titleEn } = titlesForNewEngagement(typedTitleAr, typedTitleEn, project);
      if (!titleAr && !titleEn) failFields({ title: { code: 'engagement_title_required' } });

      const number = await allocateNumber(
        tx,
        ctx.orgId,
        'design_engagement',
        'design_engagements',
        'number',
      );

      // After the number's per-org lock: that is what serialises a create against
      // a light insert (lib/client-home/ensure.ts), so each reads the other's row.
      // A refusal spends nothing: a number is max+1.
      await assertProjectHasDeliverySlot(tx, { projectId, clientId });
      const engagement = { number, titleAr, titleEn, clientId, projectId, offPlan: input.offPlan ?? false };
      return insertCreatedEngagement(tx, ctx, engagement, audit);
    },
  );
}
