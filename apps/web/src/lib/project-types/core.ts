// PURE project-type cores — no next/*, no cookies. Editable per-tenant project
// classifications. Config writes gate on `projects`/update (owner/admin/PM).
import { projectTypes } from '@metra/db';
import { and, eq, ilike, or } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';

export interface ProjectTypeInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

const NAME_MAX = 200;

/**
 * Create-on-use project type. Idempotent: an active type matching the trimmed
 * name in either language (case-insensitive) returns its id, no new row. Both
 * blank -> name_required. User-created rows carry key=null.
 */
export async function upsertProjectTypeCore(
  ctx: OrgContext,
  input: ProjectTypeInput,
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
      if (nameEn) matches.push(ilike(projectTypes.nameEn, nameEn));
      if (nameAr) matches.push(ilike(projectTypes.nameAr, nameAr));
      const [existing] = await tx
        .select({ id: projectTypes.id })
        .from(projectTypes)
        .where(
          and(
            eq(projectTypes.active, true),
            matches.length === 1 ? matches[0] : or(...matches),
          ),
        )
        .limit(1);
      if (existing) return existing.id;

      const [row] = await tx
        .insert(projectTypes)
        .values({ orgId: ctx.orgId, nameEn, nameAr, key: null })
        .returning({ id: projectTypes.id });
      await audit({
        entity: 'project_type',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { name_en: nameEn, name_ar: nameAr },
      });
      return row.id;
    },
  );
}
