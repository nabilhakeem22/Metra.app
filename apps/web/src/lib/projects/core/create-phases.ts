// The phases of creating a project that run inside createProjectCore's
// transaction around its insert: the plan's seat, the project's code, and the
// stages a new project starts with.
import { projects, projectStages, stageTemplates, type MetraDb } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';
import { failFields } from '@/lib/actions/field-errors';
import { fail } from '@/lib/actions/mutate';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { loadWorkspaceEntitlements } from '@/lib/entitlements/entitlements';
import { PROJECT_LIMIT_KEY, withinLimit } from '@/lib/entitlements/limits';
import { formatDocNumber } from '@/lib/format/doc-number';

/** Refuses when the workspace's plan has no project seat left. */
export async function assertProjectSeatFree(tx: MetraDb, ctx: OrgContext): Promise<void> {
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
}

/** The new project's code and number: the caller's code, or the next allocated one; refused when taken. */
export async function claimProjectCode(
  tx: MetraDb,
  ctx: OrgContext,
  typedCode: string | null,
): Promise<{ code: string; number: number | null }> {
  // AUTO-GENERATED code: allocate the org's next project sequence under the
  // same advisory lock the proposal/contract numbers use, then format it
  // P-YYYY-NNNN. A caller that still supplies its own code (the Public API,
  // imports) keeps it — hence the dup check below covers both paths.
  let number: number | null = null;
  let code = typedCode;
  if (!code) {
    number = await allocateNumber(tx, ctx.orgId, 'project', 'projects', 'number');
    code = formatDocNumber('P', number, new Date().getFullYear());
  }

  const [dup] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.code, code))
    .limit(1);
  if (dup) failFields({ code: { code: 'code_taken' } });
  return { code, number };
}

/** Seeds the new project's stages from the org's active stage templates, in process order. */
export async function seedProjectStages(tx: MetraDb, ctx: OrgContext, projectId: string): Promise<void> {
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
        projectId,
        stageKey: tpl.key,
        nameEn: tpl.nameEn,
        nameAr: tpl.nameAr,
        sortOrder: i,
        status: 'not_started' as const,
        progressPct: '0',
      })),
    );
  }
}
