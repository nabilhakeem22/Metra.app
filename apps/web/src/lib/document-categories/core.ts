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
import { documentCategories, type MetraDb } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';
import { isUuid } from '@/lib/uuid';

const NAME_MAX = 80;

export interface DocumentCategoryInput {
  nameEn?: string | null;
  nameAr?: string | null;
}

/** At least one locale, neither over the cap — mirrors the bilingual DB CHECK. */
function validNames(nameEn: string | null, nameAr: string | null): boolean {
  if (!nameEn && !nameAr) return false;
  return (nameEn?.length ?? 0) <= NAME_MAX && (nameAr?.length ?? 0) <= NAME_MAX;
}

/**
 * The next position at the end of the firm's list.
 *
 * Read INSIDE the caller's transaction so two concurrent adds cannot both claim
 * the same position.
 */
async function nextSortOrder(tx: MetraDb): Promise<number> {
  const [last] = await tx
    .select({ sortOrder: documentCategories.sortOrder })
    .from(documentCategories)
    .orderBy(desc(documentCategories.sortOrder))
    .limit(1);
  return (last?.sortOrder ?? -1) + 1;
}

/**
 * The ledger entry a vocabulary change leaves.
 *
 * Entity `organization`, not `document_category`: these ARE the firm's settings,
 * and a settings audit trail that scattered across per-row entities would not
 * answer "what changed about this org" in one query.
 */
function auditCategoryChange(
  audit: (entry: AuditEntry) => Promise<void>,
  orgId: string,
  entry: Pick<AuditEntry, 'before' | 'after'>,
): Promise<void> {
  return audit({
    entity: 'organization',
    entityId: orgId,
    action: 'update',
    ...entry,
  });
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
      const [row] = await tx
        .insert(documentCategories)
        .values({
          orgId: ctx.orgId,
          nameEn,
          nameAr,
          sortOrder: await nextSortOrder(tx),
        })
        .returning({ id: documentCategories.id });

      await auditCategoryChange(audit, ctx.orgId, {
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

/** Apply the rename, and the active flag ONLY when the caller sent one. */
async function applyCategoryPatch(
  tx: MetraDb,
  orgId: string,
  input: UpdateDocumentCategoryInput,
  names: { nameEn: string | null; nameAr: string | null },
): Promise<void> {
  await tx
    .update(documentCategories)
    .set({
      ...names,
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documentCategories.orgId, orgId),
        eq(documentCategories.id, input.id),
      ),
    );
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

  return mutateInOrg(
    ctx,
    { capability: 'projects', action: 'update' },
    async (tx, audit) => {
      const before = await requireInOrg(
        tx,
        documentCategories,
        input.id,
        { id: documentCategories.id, active: documentCategories.active },
        'invalid',
      );

      await applyCategoryPatch(tx, ctx.orgId, input, { nameEn, nameAr });
      await auditCategoryChange(audit, ctx.orgId, {
        before: { category_id: input.id, active: before.active },
        after: { category_id: input.id, name: nameEn ?? nameAr, active: input.active },
      });
    },
  );
}
