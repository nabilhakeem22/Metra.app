// PURE project create core. Code-uniqueness + client-usability run inside the tx;
// the composite same-org FK is the DB backstop for a cross-org client_id. Seeds the
// new project's stages from the org's active stage templates (start-from-any-phase).
import { projects } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import type { ProjectInput } from '../fields';
import { assertProjectSeatFree, claimProjectCode, seedProjectStages } from './create-phases';
import { assertClientUsable, isErr, PROJECT_REFUSALS, validate } from './validation';

export async function createProjectCore(
  ctx: OrgContext,
  input: ProjectInput,
): Promise<ActionResult & { data?: string }> {
  // A new project is ACTIVE unless the caller says otherwise: the create form
  // no longer asks (status gates no behaviour; it feeds the counts).
  const v = validate({ ...input, status: input.status ?? 'active' }, { requireStartDate: true });
  if (isErr(v)) return v;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'create', refusals: PROJECT_REFUSALS },
    async (tx, audit) => {
      await assertProjectSeatFree(tx, ctx);
      const { code, number } = await claimProjectCode(tx, ctx, v.code);
      await assertClientUsable(tx, v.clientId);

      const [row] = await tx
        .insert(projects)
        .values({ orgId: ctx.orgId, ...v, code, number })
        .returning({ id: projects.id });

      await seedProjectStages(tx, ctx, row);

      await appendSystemActivity(tx, ctx, {
        entityType: 'project',
        entityId: row.id,
        kind: 'project_created',
      });
      await audit({
        entity: 'project',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { code: v.code, client_id: v.clientId, status: v.status },
      });
      return row.id;
    },
  );
}
