import 'server-only';
// Shared guard for "the caller handed me a category id" — used by every document
// upload path (clients, projects) so they validate it the same way.
import { documentCategories } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';

/** Sentinel for "the caller sent something, and it is not a usable category". */
export const INVALID_CATEGORY = Symbol('invalid-category');

/**
 * Resolve a caller-supplied category id to one this org may actually file under, or
 * null when none was supplied (uncategorised is always allowed).
 *
 * Returns INVALID_CATEGORY for a malformed id, one belonging to another org, or a
 * RETIRED one — a document must not be filed into a category the firm has taken out
 * of service, even though existing documents stay in it. The same-org FK is the
 * database backstop; this exists so the caller gets a coded error rather than a
 * constraint violation.
 */
export async function resolveCategoryId(
  ctx: OrgContext,
  categoryId: string | null | undefined,
): Promise<string | null | typeof INVALID_CATEGORY> {
  if (categoryId === null || categoryId === undefined || categoryId === '') return null;
  if (!isUuid(categoryId)) return INVALID_CATEGORY;

  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: documentCategories.id })
      .from(documentCategories)
      .where(
        and(
          eq(documentCategories.id, categoryId),
          eq(documentCategories.active, true),
        ),
      )
      .limit(1),
  );
  return row ? row.id : INVALID_CATEGORY;
}
