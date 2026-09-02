// PURE project create core. Code-uniqueness + client-usability run inside the tx;
// the composite same-org FK is the DB backstop for a cross-org client_id. Seeds the
// new project's stages from the org's active stage templates (start-from-any-phase).
import { projects, projectStages, stageTemplates } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { allocateNumber } from '@/lib/db/allocate-number';
import { loadWorkspaceEntitlements } from '@/lib/entitlements/entitlements';
import { PROJECT_LIMIT_KEY, withinLimit } from '@/lib/entitlements/limits';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { ActionResult } from '@/lib/actions/result';
import { appendSystemActivity } from '@/lib/activities/core';
import type { OrgContext } from '@/lib/db/context';
import { assertClientUsable, isErr, validate, type ProjectInput } from './validation';

export async function createProjectCore(
  ctx: OrgContext,
  input: ProjectInput,
): Promise<ActionResult & { data?: string }> {
  const v = validate(input, { requireDates: true });
  if (isErr(v)) return v;

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'create' },
    async (tx, audit) => {
      // Plan cap (spec AC: "projects will be limited with the plan"). Counted
      // INSIDE the transaction, so two concurrent creates cannot both squeeze past
      // the last seat. An unset limit means unlimited — see withinLimit.
      const entitlements = await loadWorkspaceEntitlements(tx, ctx.orgId);
      const [{ n: projectCount }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(projects);
      if (!withinLimit(entitlements, PROJECT_LIMIT_KEY, projectCount)) {
        fail('project_limit_reached');
      }

      // AUTO-GENERATED code: allocate the org's next project sequence under the
      // same advisory lock the proposal/contract numbers use, then format it
      // P-YYYY-NNNN. A caller that still supplies its own code (the Public API,
      // imports) keeps it — hence the dup check below covers both paths.
      let number: number | null = null;
      let code = v.code;
      if (!code) {
        number = await allocateNumber(tx, ctx.orgId, 'project', 'projects', 'number');
        code = formatDocNumber('P', number, new Date().getFullYear());
      }

      const [dup] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);
      if (dup) fail('code_taken');
      await assertClientUsable(tx, v.clientId);

      const [row] = await tx
        .insert(projects)
        .values({ orgId: ctx.orgId, ...v, code, number })
        .returning({ id: projects.id });

      // Seed this project's stages from the org's active stage templates (in
      // process order). Editable afterwards — start-from-any-phase.
      const templates = await tx
        .select()
        .from(stageTemplates)
        .where(eq(stageTemplates.active, true))
        .orderBy(asc(stageTemplates.sortOrder), asc(stageTemplates.createdAt));
      if (templates.length) {
        await tx.insert(projectStages).values(
          templates.map((tpl, i) => ({
            orgId: ctx.orgId,
            projectId: row.id,
            stageKey: tpl.key,
            nameEn: tpl.nameEn,
            nameAr: tpl.nameAr,
            sortOrder: i,
            status: 'not_started' as const,
            progressPct: '0',
          })),
        );
      }

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
