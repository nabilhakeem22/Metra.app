// PURE project update cores: updateProjectCore (full header edit) +
// setProjectActiveCore (archive/restore toggle). Code-uniqueness + client-usability
// run inside the tx; the composite same-org FK is the DB backstop for a cross-org
// client_id.
import { projects } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { assertClientUsable, isErr, validate, type ProjectInput } from './validation';

export async function updateProjectCore(
  ctx: OrgContext,
  input: { id: string } & ProjectInput,
): Promise<ActionResult> {
  const v = validate(input);
  if (isErr(v)) return v;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: projects.id, clientId: projects.clientId })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.code, v.code), ne(projects.id, input.id)))
        .limit(1);
      if (dup) fail('code_taken');
      // Only require an active client when REASSIGNING to a different one.
      // Editing other fields with the same (possibly now-archived) client is
      // allowed; the composite FK still enforces same-org either way.
      if (v.clientId !== before.clientId) {
        await assertClientUsable(tx, v.clientId);
      }

      await tx
        .update(projects)
        .set({ ...v, updatedAt: new Date() })
        .where(eq(projects.id, input.id));
      await audit({
        entity: 'project',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { code: v.code, client_id: v.clientId, status: v.status },
      });
    },
  );
}

export async function setProjectActiveCore(
  ctx: OrgContext,
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: projects.id, active: projects.active })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(projects)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(projects.id, input.id));
      await audit({
        entity: 'project',
        entityId: input.id,
        action: 'update',
        before: { active: before.active },
        after: { active: input.active },
      });
    },
  );
}
