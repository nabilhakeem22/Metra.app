// Bulk price update + starter-catalogue cores. Bulk update is piastre-exact:
// the multiply+round happens in SQL (numeric), never in JS float. It writes a
// first-class price_changes header + one price_change_line per touched item
// (A2 append-only), all in one transaction.
import { costItems, priceChangeLines, priceChanges } from '@metra/db';
import { sql } from 'drizzle-orm';
import { mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { CATEGORY_TOKENS } from './import';
import { STARTER_CATALOGUE } from './starter-catalogue';
import type { CostItemCategory } from '@metra/db';

export type PriceTarget = 'cost' | 'price' | 'both';

export interface BulkUpdateInput {
  category: CostItemCategory;
  pct: number | string;
  target: PriceTarget;
  effectiveDate?: string; // YYYY-MM-DD; metadata only
}

export interface BulkUpdateSummary {
  changeId: string;
  itemCount: number;
}

interface BulkRow {
  id: string;
  old_cost: string;
  old_price: string;
  new_cost: string;
  new_price: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Applies `+pct%` to a category's cost and/or price, immediately. pct is bounded
 * to [-100, 1000] (else invalid_percentage). The multiply+round(…,4) runs in
 * Postgres numeric so results are piastre-exact; a CTE captures the pre-update
 * values so each line records old→new. Touches ONLY the given category.
 */
export async function bulkUpdatePricesCore(
  ctx: OrgContext,
  input: BulkUpdateInput,
): Promise<ActionResult & { data?: BulkUpdateSummary }> {
  // Reject a blank/whitespace pct BEFORE coercion — Number('') is 0, which would
  // otherwise pass the guard and write a no-op 0% history event.
  if (typeof input.pct === 'string' && input.pct.trim() === '') {
    return err('invalid_percentage');
  }
  const pct = typeof input.pct === 'string' ? Number(input.pct) : input.pct;
  if (!Number.isFinite(pct) || pct < -100 || pct > 1000) {
    return err('invalid_percentage');
  }
  if (input.target !== 'cost' && input.target !== 'price' && input.target !== 'both') {
    return err('invalid');
  }
  if (!CATEGORY_TOKENS.includes(input.category)) return err('invalid');
  const effectiveDate =
    input.effectiveDate && ISO_DATE.test(input.effectiveDate)
      ? input.effectiveDate
      : new Date().toISOString().slice(0, 10);

  const pctExpr = sql`(1 + ${pct.toString()}::numeric / 100)`;
  const touchCost = input.target === 'cost' || input.target === 'both';
  const touchPrice = input.target === 'price' || input.target === 'both';

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'update' },
    async (tx, audit) => {
      // Atomic: capture old values (pre-update snapshot via the FROM subquery),
      // apply round(x * (1 + pct/100), 4) in SQL, return old + new per row.
      const updated = (await tx.execute(sql`
        update public.cost_items c
        set
          default_unit_cost = ${
            touchCost
              ? sql`round(c.default_unit_cost * ${pctExpr}, 4)`
              : sql`c.default_unit_cost`
          },
          default_unit_price = ${
            touchPrice
              ? sql`round(c.default_unit_price * ${pctExpr}, 4)`
              : sql`c.default_unit_price`
          },
          updated_at = now()
        from (
          select id, default_unit_cost as old_cost, default_unit_price as old_price
          from public.cost_items
          where category::text = ${input.category}
        ) old
        where c.id = old.id
        returning
          c.id as id,
          old.old_cost as old_cost,
          old.old_price as old_price,
          c.default_unit_cost as new_cost,
          c.default_unit_price as new_price
      `)) as unknown as BulkRow[];

      const [header] = await tx
        .insert(priceChanges)
        .values({
          orgId: ctx.orgId,
          category: input.category,
          pctChange: pct.toString(),
          target: input.target,
          effectiveDate,
          appliedBy: ctx.userId,
          itemCount: updated.length,
        })
        .returning({ id: priceChanges.id });

      if (updated.length > 0) {
        await tx.insert(priceChangeLines).values(
          updated.map((r) => ({
            orgId: ctx.orgId,
            priceChangeId: header.id,
            costItemId: r.id,
            oldUnitCost: r.old_cost,
            newUnitCost: r.new_cost,
            oldUnitPrice: r.old_price,
            newUnitPrice: r.new_price,
          })),
        );
      }

      await audit({
        entity: 'price_change',
        entityId: header.id,
        action: 'create',
        before: null,
        after: {
          category: input.category,
          pct_change: pct.toString(),
          target: input.target,
          item_count: updated.length,
        },
      });

      return { changeId: header.id, itemCount: updated.length };
    },
  );
}

export interface StarterLoadSummary {
  inserted: number;
  total: number;
}

/**
 * Opt-in starter catalogue. Idempotent: inserts the ~40 items skipping any code
 * that already exists in the org (onConflict on unique(org_id, code)).
 */
export async function loadStarterCatalogueCore(
  ctx: OrgContext,
): Promise<ActionResult & { data?: StarterLoadSummary }> {
  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create' },
    async (tx, audit) => {
      const inserted = await tx
        .insert(costItems)
        .values(
          STARTER_CATALOGUE.map((it) => ({
            orgId: ctx.orgId,
            code: it.code,
            nameEn: it.nameEn,
            nameAr: it.nameAr,
            category: it.category,
            unit: it.unit,
            defaultUnitCost: it.defaultUnitCost,
            defaultUnitPrice: it.defaultUnitPrice,
          })),
        )
        .onConflictDoNothing({
          target: [costItems.orgId, costItems.code],
        })
        .returning({ id: costItems.id });

      if (inserted.length > 0) {
        await audit({
          entity: 'cost_item_starter',
          entityId: null,
          action: 'create',
          before: null,
          after: { inserted: inserted.length, total: STARTER_CATALOGUE.length },
        });
      }

      return { inserted: inserted.length, total: STARTER_CATALOGUE.length };
    },
  );
}
