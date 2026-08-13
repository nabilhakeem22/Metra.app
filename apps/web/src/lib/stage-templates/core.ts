// PURE stage-template cores — the org-wide editable stage process. Config writes
// gate on `projects`/update (owner/admin/PM). Editing templates never rewrites
// live projects (a project owns a copy in project_stages).
import { stageTemplates } from '@metra/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';

export interface StageTemplateInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

const NAME_MAX = 200;

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** Create-on-use stage template (idempotent by name, either language). */
export async function upsertStageTemplateCore(
  ctx: OrgContext,
  input: StageTemplateInput,
): Promise<ActionResult & { data?: string }> {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if ((nameEn?.length ?? 0) > NAME_MAX || (nameAr?.length ?? 0) > NAME_MAX) {
    return err('invalid');
  }

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const matches = [];
      if (nameEn) matches.push(ilike(stageTemplates.nameEn, nameEn));
      if (nameAr) matches.push(ilike(stageTemplates.nameAr, nameAr));
      const [existing] = await tx
        .select({ id: stageTemplates.id })
        .from(stageTemplates)
        .where(
          and(
            eq(stageTemplates.active, true),
            matches.length === 1 ? matches[0] : or(...matches),
          ),
        )
        .limit(1);
      if (existing) return existing.id;

      // New templates go to the end of the process.
      const [maxRow] = await tx
        .select({ max: stageTemplates.sortOrder })
        .from(stageTemplates)
        .orderBy(stageTemplates.sortOrder)
        .limit(1);
      const [row] = await tx
        .insert(stageTemplates)
        .values({
          orgId: ctx.orgId,
          nameEn,
          nameAr,
          key: null,
          sortOrder: (maxRow?.max ?? 0) + 100,
        })
        .returning({ id: stageTemplates.id });
      await audit({
        entity: 'stage_template',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { name_en: nameEn, name_ar: nameAr },
      });
      return row.id;
    },
  );
}

export async function updateStageTemplateCore(
  ctx: OrgContext,
  input: { id: string } & StageTemplateInput,
): Promise<ActionResult> {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!nameEn && !nameAr) return err('name_required');
  if ((nameEn?.length ?? 0) > NAME_MAX || (nameAr?.length ?? 0) > NAME_MAX) {
    return err('invalid');
  }
  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: stageTemplates.id })
        .from(stageTemplates)
        .where(eq(stageTemplates.id, input.id))
        .limit(1);
      if (!before) fail('invalid');
      await tx
        .update(stageTemplates)
        .set({ nameEn, nameAr, updatedAt: new Date() })
        .where(eq(stageTemplates.id, input.id));
      await audit({
        entity: 'stage_template',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { name_en: nameEn, name_ar: nameAr },
      });
    },
  );
}

export async function setStageTemplateActiveCore(
  ctx: OrgContext,
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: stageTemplates.id, active: stageTemplates.active })
        .from(stageTemplates)
        .where(eq(stageTemplates.id, input.id))
        .limit(1);
      if (!before) fail('invalid');
      await tx
        .update(stageTemplates)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(stageTemplates.id, input.id));
      await audit({
        entity: 'stage_template',
        entityId: input.id,
        action: 'update',
        before: { active: before.active },
        after: { active: input.active },
      });
    },
  );
}
