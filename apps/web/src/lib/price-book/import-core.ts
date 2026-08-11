// Import cores: parse (server-only SheetJS) + validate + insert-only bulk import.
// parseCostImportCore is CPU-only (no DB) so it gates with can() directly;
// importCostItemsCore writes through mutateInOrg. Partial success is a hard
// contract: valid rows import, invalid rows are per-row errors, the whole file
// is NEVER rejected.
import { costItems } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import {
  validateImportRows,
  type ColumnMapping,
  type ValidatedRow,
} from './import';
import { parseSpreadsheet, SpreadsheetError, type ParsedSheet } from './parse';

export function parseCostImportCore(
  ctx: OrgContext,
  input: { bytes: Uint8Array },
): ActionResult & { data?: ParsedSheet } {
  if (!can(ctx.role, 'price_book', 'create')) return err('forbidden');
  try {
    const sheet = parseSpreadsheet(input.bytes);
    if (sheet.data.length === 0) return err('import_empty');
    return { ok: true, data: sheet };
  } catch (e) {
    if (e instanceof SpreadsheetError) {
      return err(e.reason === 'empty' ? 'import_empty' : 'invalid');
    }
    console.error('parseCostImportCore failed:', e);
    return err('generic');
  }
}

export interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  /** One entry per input row, in order (ok:true imported, ok:false skipped). */
  results: ValidatedRow[];
}

/**
 * Insert-only bulk import. Re-validates server-side against the org's live codes
 * (never trusts a client preview), inserts the valid rows in one transaction,
 * and returns a per-row summary. A row whose code already exists is skipped with
 * `code_exists` — the rest still import.
 */
export async function importCostItemsCore(
  ctx: OrgContext,
  input: { rows: string[][]; mapping: ColumnMapping },
): Promise<ActionResult & { data?: ImportSummary }> {
  if (input.rows.length === 0) return err('import_empty');

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create' },
    async (tx, audit) => {
      const existing = await tx
        .select({ code: costItems.code })
        .from(costItems);
      const existingCodes = new Set(
        existing.map((r) => r.code.toLowerCase()),
      );

      const results = validateImportRows(input.rows, input.mapping, existingCodes);
      const valid = results.filter((r) => r.ok && r.data);

      if (valid.length > 0) {
        await tx.insert(costItems).values(
          valid.map((r) => ({
            orgId: ctx.orgId,
            code: r.data!.code,
            nameEn: r.data!.nameEn,
            nameAr: r.data!.nameAr,
            category: r.data!.category,
            unit: r.data!.unit,
            defaultUnitCost: r.data!.defaultUnitCost,
            defaultUnitPrice: r.data!.defaultUnitPrice,
            taxCode: r.data!.taxCode,
            etaItemCode: r.data!.etaItemCode,
            etaCodeType: r.data!.etaCodeType,
          })),
        );
      }

      const imported = valid.length;
      const skipped = results.length - imported;

      await audit({
        entity: 'cost_item_import',
        entityId: null,
        action: 'create',
        before: null,
        after: { total: results.length, imported, skipped },
      });

      return {
        total: results.length,
        imported,
        skipped,
        results,
      } satisfies ImportSummary;
    },
  );
}
