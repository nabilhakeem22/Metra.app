// Bulk price update core. Piastre-exact: the multiply+round happens in SQL
// (./bulk-apply). It writes a first-class price_changes header + one
// price_change_line per touched item (A2 append-only), all in one transaction.
import { sections, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import { failFields, fieldsFailed } from '@/lib/actions/field-errors';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { applyBulkPercent } from './bulk-apply';
import { recordPriceChange } from './bulk-history';
import { bulkPercentError } from './percent';

export type PriceTarget = 'cost' | 'price' | 'both';

export interface BulkUpdateInput {
  sectionId: string;
  /** The decimal STRING the user typed. Never a number: see isBulkPercent. */
  pct: string;
  target: PriceTarget;
  effectiveDate?: string; // YYYY-MM-DD; metadata only
}

export interface BulkUpdateSummary {
  changeId: string;
  itemCount: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The category's label as history freezes it, or the refusal under the category box when it is gone. */
async function requireCategorySnapshot(tx: MetraDb, sectionId: string): Promise<string> {
  // The section must exist in THIS org (RLS-scoped); one deleted meanwhile
  // is said under the category. Its snapshot text is frozen onto the
  // price_changes row (NOT an FK).
  const [section] = await tx
    .select({ key: sections.key, nameEn: sections.nameEn, nameAr: sections.nameAr })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .limit(1);
  if (!section) failFields({ sectionId: { code: 'no_longer_exists' } });
  const categorySnapshot =
    section.key ?? section.nameEn ?? section.nameAr ?? sectionId;
  return categorySnapshot;
}

/**
 * Applies `+pct%` to a category's cost and/or price, immediately. A pct that is
 * not a number, or is outside [-100, 1000], is refused under the percentage box;
 * a category deleted meanwhile under the category box. Each line records
 * old to new. Touches ONLY the given category.
 */
export async function bulkUpdatePricesCore(
  ctx: OrgContext,
  input: BulkUpdateInput,
): Promise<ActionResult & { data?: BulkUpdateSummary }> {
  // Shape AND range in one gate. Number() alone read '1e2' as 100, '0x1A' as 26
  // and ' 5 ' as 5, so a value that never looked like a percentage was coerced
  // into one and then interpolated into the SQL numeric literal below.
  const pctError = bulkPercentError(input.pct);
  if (pctError) return fieldsFailed({ pct: pctError });
  if (input.target !== 'cost' && input.target !== 'price' && input.target !== 'both') {
    return err('malformed');
  }
  if (!isUuid(input.sectionId)) return err('malformed');
  const effectiveDate =
    input.effectiveDate && ISO_DATE.test(input.effectiveDate)
      ? input.effectiveDate
      : new Date().toISOString().slice(0, 10);

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'update' },
    async (tx, audit) => {
      const categorySnapshot = await requireCategorySnapshot(tx, input.sectionId);

      const updated = await applyBulkPercent(tx, input.sectionId, input.pct, input.target);

      const change = { categorySnapshot, pct: input.pct, target: input.target, effectiveDate, updated };
      const header = await recordPriceChange(tx, ctx, change);

      await audit({
        entity: 'price_change',
        entityId: header.id,
        action: 'create',
        before: null,
        after: {
          section_id: input.sectionId,
          category: categorySnapshot,
          pct_change: input.pct,
          target: input.target,
          item_count: updated.length,
        },
      });

      return { changeId: header.id, itemCount: updated.length };
    },
  );
}
