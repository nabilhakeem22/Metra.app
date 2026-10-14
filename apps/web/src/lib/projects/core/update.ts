// PURE project update cores: updateProjectCore (full header edit) +
// setProjectActiveCore (archive/restore toggle). Code-uniqueness + client-usability
// run inside the tx; the composite same-org FK is the DB backstop for a cross-org
// client_id.
import { projects } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import type { ProjectInput } from '../fields';
import { assertClientUsable, isErr, PROJECT_REFUSALS, validate } from './validation';

export async function updateProjectCore(
  ctx: OrgContext,
  input: { id: string } & ProjectInput,
): Promise<ActionResult> {
  const v = validate(input, { requireCode: true });
  if (isErr(v)) return v;
  // `requireCode` already refused a blank code under its field; restated so the
  // type narrows too.
  if (!v.code) return fieldsFailed({ code: { code: 'code_required' } });
  const code = v.code;
  // Same partial-update guard as clients: the Details form stopped sending these
  // when they moved to Financials, and `validate` normalizes an absent percentage to
  // '0'. Without this, an ordinary project save would silently zero both columns.
  const keepAdvance = input.advancePct === undefined;
  const keepRetention = input.retentionPct === undefined;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update', refusals: PROJECT_REFUSALS },
    async (tx, audit) => {
      const before = await requireInOrg(
        tx,
        projects,
        input.id,
        { id: projects.id, clientId: projects.clientId },
        'invalid',
      );

      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.code, code), ne(projects.id, input.id)))
        .limit(1);
      if (dup) failFields({ code: { code: 'code_taken' } });
      // Only require an active client when REASSIGNING to a different one.
      // Editing other fields with the same (possibly now-archived) client is
      // allowed; the composite FK still enforces same-org either way.
      if (v.clientId !== before.clientId) {
        await assertClientUsable(tx, v.clientId);
      }

      // Destructure the two percentages OUT and add them back only when the caller
      // actually sent them. Setting a key to `undefined` is not enough — postgres.js
      // rejects undefined values outright (UNDEFINED_VALUE), so the key must be
      // absent from the object, not present-and-undefined.
      const { advancePct, retentionPct, ...rest } = v;
      await tx
        .update(projects)
        .set({
          ...rest,
          ...(keepAdvance ? {} : { advancePct }),
          ...(keepRetention ? {} : { retentionPct }),
          code,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.id));
      await audit({
        entity: 'project',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { code, client_id: v.clientId, status: v.status },
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
      const before = await requireInOrg(
        tx,
        projects,
        input.id,
        { id: projects.id, active: projects.active },
        'invalid',
      );

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
