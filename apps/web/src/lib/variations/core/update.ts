// Variation-order draft edits: saveVariationDraftCore. The server recomputes EVERY
// line total + the netDelta from the money engine and never trusts a client-supplied
// total (Money law). A VO line may be a NEGATIVE de-scope (negative qty), so
// netDelta may be negative.
import {
  contractLines,
  variationOrderLines,
  variationOrders,
  type CostItemUnit,
} from '@metra/db';
import { and, eq, inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { computeVariationNetDelta } from '@/lib/aggregates/contract-value';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import { readMoney } from '@/lib/money/read';
import type { OrgContext } from '@/lib/db/context';
import {
  chunk,
  LINE_INSERT_CHUNK,
  MAX_TOTAL_LINES,
  normalizeText,
  pctInRange,
  withinMagnitude,
} from '@/lib/proposals/core';
import { isUuid } from '@/lib/uuid';
import { SIGNED_MONEY_FIELD } from '../validation';

export interface VariationLineInput {
  /** Baseline contract line this changes; null/absent = brand-new scope. */
  contractLineId?: string | null;
  costItemId?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  /** May be NEGATIVE for a de-scope. */
  qty?: string | null;
  unit?: CostItemUnit | null;
  unitCost?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  sortOrder?: number;
}

export interface SaveVariationDraftInput {
  id: string;
  header?: {
    titleAr?: string | null;
    titleEn?: string | null;
    reasonAr?: string | null;
    reasonEn?: string | null;
  };
  lines: VariationLineInput[];
}

/**
 * Save a DRAFT VO's lines + header. The server recomputes every line total from
 * the money engine (client totals ignored) and the netDelta = Σ lineTotal (may be
 * negative). Rejects a non-draft VO with `variation_not_draft`. The DB child-draft
 * trigger is the second guard (frozen once the VO leaves draft).
 */
export async function saveVariationDraftCore(
  ctx: OrgContext,
  input: SaveVariationDraftInput,
): Promise<ActionResult> {
  const id = input.id?.trim();
  if (!id || !isUuid(id)) return err('invalid');
  const lines = input.lines ?? [];
  if (lines.length > MAX_TOTAL_LINES) return err('too_many_lines');

  // Normalize + validate every line up front (nothing persists on a bad input).
  const prepared: Array<{
    contractLineId: string | null;
    costItemId: string | null;
    descriptionAr: string | null;
    descriptionEn: string | null;
    qty: string;
    unit: CostItemUnit;
    unitCost: string;
    unitPrice: string;
    discountPct: string;
    lineCost: string;
    lineTotal: string;
    lineMargin: string;
    sortOrder: number;
  }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    const descriptionAr = normalizeText(l.descriptionAr);
    const descriptionEn = normalizeText(l.descriptionEn);
    if (!descriptionAr && !descriptionEn) return err('line_required');
    const qty = readMoney(l.qty, SIGNED_MONEY_FIELD);
    const unitCost = readMoney(l.unitCost, { blank: '0' });
    const unitPrice = readMoney(l.unitPrice, { blank: '0' });
    const discountPct = readMoney(l.discountPct, { blank: '0' });
    if (!qty.ok || !unitCost.ok || !unitPrice.ok || !discountPct.ok) {
      // Past the cap is its own answer: a bare `invalid` on a variation line
      // whose quantity is 1e13 tells the studio nothing it can act on.
      const factors = [qty, unitCost, unitPrice, discountPct];
      const tooLarge = factors.some((f) => !f.ok && f.reason === 'too_large');
      return err(tooLarge ? 'amount_too_large' : 'invalid');
    }
    if (!pctInRange(discountPct.value)) return err('discount_out_of_range');
    // The per-FACTOR magnitude loop that used to sit here is gone: the reader
    // applies MAX_AMOUNT itself, so an over-cap factor already came back null and
    // failed 'invalid' above. The PRODUCT check below was never redundant.
    if (!l.unit) return err('invalid');

    const totals = computeLine({
      qty: qty.value,
      unitCost: unitCost.value,
      unitPrice: unitPrice.value,
      discountPct: discountPct.value,
    });
    // The FACTORS were each inside the cap; their PRODUCT need not be. A
    // line total past the cap overflows numeric(18,4) at the database — and so
    // does a line cost or margin, which are persisted on the same row. A signed
    // qty makes the margin the widest of the three, so none of them is implied
    // by the others.
    if (
      !withinMagnitude(totals.lineTotal) ||
      !withinMagnitude(totals.lineCost) ||
      !withinMagnitude(totals.lineMargin)
    ) {
      return err('amount_too_large');
    }
    prepared.push({
      contractLineId: l.contractLineId?.trim() || null,
      costItemId: l.costItemId?.trim() || null,
      descriptionAr,
      descriptionEn,
      qty: qty.value,
      unit: l.unit,
      unitCost: unitCost.value,
      unitPrice: unitPrice.value,
      discountPct: discountPct.value,
      lineCost: totals.lineCost,
      lineTotal: totals.lineTotal,
      lineMargin: totals.lineMargin,
      sortOrder: l.sortOrder ?? i,
    });
  }
  const netDelta = computeVariationNetDelta(
    prepared.map((p) => ({
      lineCost: p.lineCost,
      lineTotal: p.lineTotal,
      lineMargin: p.lineMargin,
    })),
  );
  // …and the SUM of the lines need not be inside the cap either.
  if (!withinMagnitude(netDelta)) return err('amount_too_large');

  return mutateInOrg(
    ctx,
    { capability: 'variations_draft', action: 'update' },
    async (tx, audit) => {
      // R1: lock the VO row FOR UPDATE before touching its lines, so an
      // internal-approval (which also locks this row to freeze net_delta) can
      // never read a half-rewritten line set. The two operations serialize here.
      const [vo] = await tx
        .select({
          status: variationOrders.status,
          contractId: variationOrders.contractId,
        })
        .from(variationOrders)
        .where(eq(variationOrders.id, id))
        .for('update')
        .limit(1);
      if (!vo) fail('invalid');
      if (vo.status !== 'draft') fail('variation_not_draft');

      // Any provided baseline line ids must belong to THIS VO's contract (rejects
      // a wrong contract's line before the composite FK would).
      const baselineIds = [
        ...new Set(
          prepared
            .map((p) => p.contractLineId)
            .filter((x): x is string => x !== null),
        ),
      ];
      if (baselineIds.length) {
        const found = await tx
          .select({ id: contractLines.id })
          .from(contractLines)
          .where(
            and(
              inArray(contractLines.id, baselineIds),
              eq(contractLines.contractId, vo.contractId),
            ),
          );
        if (found.length !== baselineIds.length) fail('invalid');
      }

      await tx
        .delete(variationOrderLines)
        .where(eq(variationOrderLines.variationOrderId, id));

      if (prepared.length) {
        const rows = prepared.map((p) => ({
          orgId: ctx.orgId,
          variationOrderId: id,
          contractLineId: p.contractLineId,
          costItemId: p.costItemId,
          descriptionAr: p.descriptionAr,
          descriptionEn: p.descriptionEn,
          qty: p.qty,
          unit: p.unit,
          unitCost: p.unitCost,
          unitPrice: p.unitPrice,
          discountPct: p.discountPct,
          lineCost: p.lineCost,
          lineTotal: p.lineTotal,
          lineMargin: p.lineMargin,
          sortOrder: p.sortOrder,
        }));
        for (const part of chunk(rows, LINE_INSERT_CHUNK)) {
          await tx.insert(variationOrderLines).values(part);
        }
      }

      const h = input.header ?? {};
      // Assert the gate: if the VO left draft between the lock and here (it can't,
      // since we hold the row lock — but stay defensive), affect 0 rows and fail
      // loudly rather than silently reporting ok while the row is frozen.
      const saved = await tx
        .update(variationOrders)
        .set({
          ...(h.titleAr !== undefined ? { titleAr: normalizeText(h.titleAr) } : {}),
          ...(h.titleEn !== undefined ? { titleEn: normalizeText(h.titleEn) } : {}),
          ...(h.reasonAr !== undefined ? { reasonAr: normalizeText(h.reasonAr) } : {}),
          ...(h.reasonEn !== undefined ? { reasonEn: normalizeText(h.reasonEn) } : {}),
          netDelta,
          updatedAt: new Date(),
        })
        .where(and(eq(variationOrders.id, id), eq(variationOrders.status, 'draft')))
        .returning({ id: variationOrders.id });
      if (!saved[0]) fail('variation_not_draft');

      await audit({
        entity: 'variation_order',
        entityId: id,
        action: 'update',
        before: null,
        after: { lines: prepared.length, net_delta: netDelta },
      });
    },
  );
}
