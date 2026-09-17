// Pricing an imported BOQ line: which cost basis it gets, and whether the numbers
// it produces can be stored at all. Split out of ./commit-import.ts so that file
// is the SHAPE of the import and this one is the arithmetic.
import { boqLines, costItems } from '@metra/db';
import { inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { computeLine, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { withinMagnitude } from '@/lib/money/read';
import type { ImportedLine } from '../import/map';
import { bilingualFor } from '../bilingual';

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];
export type PendingLine = typeof boqLines.$inferInsert;
export type PriceBook = Map<string, { id: string; defaultUnitCost: string }>;

/**
 * Resolve price-book codes in ONE query, not one per line. A code that matches
 * gives the line a real cost basis — which is the difference between a BOQ that
 * can report margin later and one that can only count quantities. A code that
 * matches nothing is not an error: the line simply keeps whatever cost the sheet
 * carried.
 */
export async function resolvePriceBook(tx: Tx, lines: ImportedLine[]): Promise<PriceBook> {
  const codes = [
    ...new Set(lines.map((l) => l.costItemCode).filter((c): c is string => Boolean(c))),
  ];
  const priceBook: PriceBook = new Map();
  if (codes.length === 0) return priceBook;
  const found = await tx
    .select({
      id: costItems.id,
      code: costItems.code,
      defaultUnitCost: costItems.defaultUnitCost,
    })
    .from(costItems)
    .where(inArray(costItems.code, codes));
  for (const item of found) {
    priceBook.set(item.code, { id: item.id, defaultUnitCost: item.defaultUnitCost });
  }
  return priceBook;
}

/** One line row, priced and checked. */
export function buildImportedLine(
  context: { orgId: string; boqId: string; sectionId: string; priceBook: PriceBook },
  line: ImportedLine,
  sortOrder: number,
): PendingLine {
  const matched = line.costItemCode ? context.priceBook.get(line.costItemCode) : undefined;
  // The sheet wins when it carries a cost: a studio that overrode the catalogue
  // rate for this project meant it. The price book only fills the gap. Compared
  // as a NUMBER, not as the string '0': a cell reading 0.00 or 0.0000 is the same
  // "no cost" as an empty one, but as a string it is not equal to '0', so it used
  // to count as an override and silently suppress the catalogue rate — a
  // margin-blind line that looked priced.
  const unitCost =
    parseMoney4(line.unitCost) !== 0n ? line.unitCost : (matched?.defaultUnitCost ?? '0');

  const totals = computeLine({
    qty: line.qty,
    unitPrice: line.unitPrice,
    unitCost,
    discountPct: '0',
  });
  // The FACTORS were each inside the cap; their PRODUCT need not be. An imported
  // sheet is the likeliest source of an absurd qty x price, and a line total past
  // the cap overflows numeric(18,4) at the database. The cost side is checked
  // too: the catalogue rate behind unitCost is not something the importing sheet
  // showed the user at all.
  if (
    !withinMagnitude(totals.lineTotal) ||
    !withinMagnitude(totals.lineCost) ||
    !withinMagnitude(totals.lineMargin)
  ) {
    fail('amount_too_large');
  }
  return {
    orgId: context.orgId,
    boqId: context.boqId,
    sectionId: context.sectionId,
    costItemId: matched?.id ?? null,
    itemCode: line.itemCode,
    ...bilingualFor(line.description),
    qty: line.qty,
    unit: line.unit as PendingLine['unit'],
    unitPrice: line.unitPrice,
    unitCost,
    provisional: line.provisional,
    sortOrder,
    ...totals,
  };
}
