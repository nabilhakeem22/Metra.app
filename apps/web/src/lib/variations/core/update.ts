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
import type { OrgContext } from '@/lib/db/context';
import {
  chunk,
  LINE_INSERT_CHUNK,
  MAX_TOTAL_LINES,
  normalizeMoney,
  normalizeText,
  pctInRange,
  withinMagnitude,
} from '@/lib/proposals/core';
import { MONEY_RE } from '@/lib/aggregates/proposal-totals';
import { UUID_RE } from './shared';

/** Signed money string (allows a negative de-scope qty), or null if malformed. */
function normalizeSignedMoney(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (s === undefined || s === '') return '0';
  if (!MONEY_RE.test(s)) return null;
  return s;
}

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
  if (!id || !UUID_RE.test(id)) return err('invalid');
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
    const qty = normalizeSignedMoney(l.qty);
    const unitCost = normalizeMoney(l.unitCost);
    const unitPrice = normalizeMoney(l.unitPrice);
    const discountPct = normalizeMoney(l.discountPct);
    if (qty === null || unitCost === null || unitPrice === null || discountPct === null) {
      return err('invalid');
    }
    if (!pctInRange(discountPct)) return err('discount_out_of_range');
    for (const v of [qty, unitCost, unitPrice]) {
      if (!withinMagnitude(v)) return err('amount_too_large');
    }
    if (!l.unit) return err('invalid');

    const totals = computeLine({ qty, unitCost, unitPrice, discountPct });
    prepared.push({
      contractLineId: l.contractLineId?.trim() || null,
      costItemId: l.costItemId?.trim() || null,
      descriptionAr,
      descriptionEn,
      qty,
      unit: l.unit,
      unitCost,
      unitPrice,
      discountPct,
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
