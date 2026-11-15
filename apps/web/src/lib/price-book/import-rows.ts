// The two phases of a cost-item import that touch the book, inside
// importCostItemsCore's transaction: check the sheet against the live codes and
// categories, then insert the rows that passed.
import { costItems, sections, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { validateImportRows, type ColumnMapping, type ValidatedRow } from './import';

/** Every row of the sheet, checked against the org's live codes and active categories; one answer per row. */
export async function revalidateImportRows(
  tx: MetraDb,
  input: { rows: string[][]; mapping: ColumnMapping },
): Promise<ValidatedRow[]> {
  const existing = await tx
    .select({ code: costItems.code })
    .from(costItems);
  // Case-SENSITIVE, matching the DB unique(org_id, code).
  const existingCodes = new Set(existing.map((r) => r.code));

  // The org's sections drive resolution; an unknown token -> category_invalid.
  const orgSections = await tx
    .select({
      id: sections.id,
      key: sections.key,
      nameEn: sections.nameEn,
      nameAr: sections.nameAr,
    })
    .from(sections)
    .where(eq(sections.active, true));

  const results = validateImportRows(
    input.rows,
    input.mapping,
    existingCodes,
    orgSections,
  );
  return results;
}

/** Inserts the rows that passed, in one statement; writes nothing when none did. */
export async function insertValidRows(tx: MetraDb, ctx: OrgContext, valid: ValidatedRow[]): Promise<void> {
  if (valid.length > 0) {
    await tx.insert(costItems).values(
      valid.map((r) => ({
        orgId: ctx.orgId,
        code: r.data!.code,
        nameEn: r.data!.nameEn,
        nameAr: r.data!.nameAr,
        sectionId: r.data!.sectionId,
        unit: r.data!.unit,
        defaultUnitCost: r.data!.defaultUnitCost,
        defaultUnitPrice: r.data!.defaultUnitPrice,
        taxCode: r.data!.taxCode,
        etaItemCode: r.data!.etaItemCode,
        etaCodeType: r.data!.etaCodeType,
      })),
    );
  }
}
