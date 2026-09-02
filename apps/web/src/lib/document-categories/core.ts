import 'server-only';
// The firm's document filing vocabulary — create, rename, reorder, retire.
//
// Gated on `projects`/`update`, matching the other firm-vocabulary settings screens
// (stage templates, project types) — there is no separate `settings` capability, and
// inventing one would put this behind a different door than its neighbours.
//
// Managed from Settings, and deliberately shallow: nothing in the app branches on
// which category a document is in, so a firm can name these whatever it likes
// without changing any behaviour. That is what makes the vocabulary theirs rather
// than ours.
//
// RETIRE, DON'T DELETE. There is no delete path and no DELETE grant: files point at
// a category, and pulling one out from under filed documents is not something a
// misclick should be able to do. `active = false` removes it from the picker and
// leaves everything already filed exactly where it is.
import { documentCategories } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';

const NAME_MAX = 80;

export interface DocumentCategoryInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

function clean(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

/** At least one locale, neither over the cap — mirrors the bilingual DB CHECK. */
function validNames(nameEn: string | null, nameAr: string | null): boolean {
  if (!nameEn && !nameAr) return false;
  return (nameEn?.length ?? 0) <= NAME_MAX && (nameAr?.length ?? 0) <= NAME_MAX;
}

/**
 * Add a category to the end of the firm's list. `key` stays null — that column marks
 * a row that came from the seeded defaults, and a firm's own category is not one.
 */
export async function createDocumentCategoryCore(
  ctx: OrgContext,
  input: DocumentCategoryInput,
): Promise<ActionResult & { data?: string }> {
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!validNames(nameEn, nameAr)) return err('name_required');

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      // Append after the current last row. Read inside the tx so two concurrent
      // adds cannot both claim the same position.
      const [last] = await tx
        .select({ sortOrder: documentCategories.sortOrder })
        .from(documentCategories)
        .orderBy(desc(documentCategories.sortOrder))
        .limit(1);
      const nextOrder = (last?.sortOrder ?? -1) + 1;

      const [row] = await tx
        .insert(documentCategories)
        .values({ orgId: ctx.orgId, nameEn, nameAr, sortOrder: nextOrder })
        .returning({ id: documentCategories.id });

      await audit({
        entity: 'organization',
        entityId: ctx.orgId,
        action: 'update',
        after: { document_category_added: nameEn ?? nameAr },
      });
      return row.id;
    },
  );
}

export interface UpdateDocumentCategoryInput extends DocumentCategoryInput {
  id: string;
  /** Omitted means "leave it alone" — the same partial-update discipline the client
   *  and project cores use, so a rename cannot silently retire a category. */
  active?: boolean;
}

/** Rename and/or activate-deactivate ONE category. */
export async function updateDocumentCategoryCore(
  ctx: OrgContext,
  input: UpdateDocumentCategoryInput,
): Promise<ActionResult> {
  if (!isUuid(input.id)) return err('invalid');
  const nameEn = clean(input.nameEn);
  const nameAr = clean(input.nameAr);
  if (!validNames(nameEn, nameAr)) return err('name_required');
  const setActive = typeof input.active === 'boolean';

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: documentCategories.id, active: documentCategories.active })
        .from(documentCategories)
        .where(eq(documentCategories.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(documentCategories)
        .set({
          nameEn,
          nameAr,
          ...(setActive ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(documentCategories.orgId, ctx.orgId),
            eq(documentCategories.id, input.id),
          ),
        );

      await audit({
        entity: 'organization',
        entityId: ctx.orgId,
        action: 'update',
        before: { category_id: input.id, active: before.active },
        after: { category_id: input.id, name: nameEn ?? nameAr, active: input.active },
      });
    },
  );
}
