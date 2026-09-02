// PURE price-book CRUD cores — no next/*, no getSessionUser, no cookies. Take an
// OrgContext + validated input; the 'use server' wrappers in ./actions do the
// session/requireOrg work and delegate. Exercised directly by *.dbtest.ts.
import { costItems, sections, type CostItemUnit, type MetraDb } from '@metra/db';
import { and, eq, ne } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { UNIT_TOKENS } from './import';
import { isUuid } from '@/lib/uuid';
import { clampMoney4 } from '@/lib/aggregates/proposal-totals';

export interface CostItemInput {
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
  sectionId: string;
  unit: CostItemUnit;
  defaultUnitCost?: string | null;
  defaultUnitPrice?: string | null;
  taxCode?: string | null;
  etaItemCode?: string | null;
  etaCodeType?: string | null;
}

function isUnit(v: unknown): v is CostItemUnit {
  return UNIT_TOKENS.includes(v as CostItemUnit);
}

/** The section must exist in THIS org (RLS-scoped tx). Returns true if usable. */
async function sectionUsable(
  tx: MetraDb,
  sectionId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .limit(1);
  return !!row;
}

/** Normalize a money input to a non-negative decimal string, or null if bad. */
function normMoney(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return '0';
  const cleaned = v.trim().replace(/,/g, '');
  if (cleaned === '') return '0';
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  // Same reason as proposals' normalizeMoney: clamp to the numeric(18,4) scale so
  // what the app computed and what the database stores cannot diverge.
  return clampMoney4(cleaned);
}

export async function createCostItemCore(
  ctx: OrgContext,
  input: CostItemInput,
): Promise<ActionResult> {
  const code = input.code?.trim();
  if (!code) return err('code_required');
  const nameEn = input.nameEn?.trim() || null;
  const nameAr = input.nameAr?.trim() || null;
  if (!nameEn && !nameAr) return err('name_required');
  if (!isUuid(input.sectionId) || !isUnit(input.unit)) {
    return err('invalid');
  }
  const cost = normMoney(input.defaultUnitCost);
  const price = normMoney(input.defaultUnitPrice);
  if (cost === null || price === null) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create' },
    async (tx, audit) => {
      if (!(await sectionUsable(tx, input.sectionId))) fail('invalid');

      const [dup] = await tx
        .select({ id: costItems.id })
        .from(costItems)
        .where(eq(costItems.code, code))
        .limit(1);
      if (dup) fail('code_taken');

      const [row] = await tx
        .insert(costItems)
        .values({
          orgId: ctx.orgId,
          code,
          nameEn,
          nameAr,
          sectionId: input.sectionId,
          unit: input.unit,
          defaultUnitCost: cost,
          defaultUnitPrice: price,
          taxCode: input.taxCode?.trim() || null,
          etaItemCode: input.etaItemCode?.trim() || null,
          etaCodeType: input.etaCodeType?.trim() || null,
        })
        .returning({ id: costItems.id });

      await audit({
        entity: 'cost_item',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { code, nameEn, nameAr, section_id: input.sectionId, unit: input.unit },
      });
      return row.id;
    },
  );
}

export async function updateCostItemCore(
  ctx: OrgContext,
  input: { id: string } & CostItemInput,
): Promise<ActionResult> {
  const code = input.code?.trim();
  if (!code) return err('code_required');
  const nameEn = input.nameEn?.trim() || null;
  const nameAr = input.nameAr?.trim() || null;
  if (!nameEn && !nameAr) return err('name_required');
  if (!isUuid(input.sectionId) || !isUnit(input.unit)) {
    return err('invalid');
  }
  const cost = normMoney(input.defaultUnitCost);
  const price = normMoney(input.defaultUnitPrice);
  if (cost === null || price === null) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select()
        .from(costItems)
        .where(eq(costItems.id, input.id))
        .limit(1);
      if (!before) fail('invalid');
      if (!(await sectionUsable(tx, input.sectionId))) fail('invalid');

      // Code must stay unique within the org (excluding this row).
      const [dup] = await tx
        .select({ id: costItems.id })
        .from(costItems)
        .where(and(eq(costItems.code, code), ne(costItems.id, input.id)))
        .limit(1);
      if (dup) fail('code_taken');

      await tx
        .update(costItems)
        .set({
          code,
          nameEn,
          nameAr,
          sectionId: input.sectionId,
          unit: input.unit,
          defaultUnitCost: cost,
          defaultUnitPrice: price,
          taxCode: input.taxCode?.trim() || null,
          etaItemCode: input.etaItemCode?.trim() || null,
          etaCodeType: input.etaCodeType?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(costItems.id, input.id));

      await audit({
        entity: 'cost_item',
        entityId: input.id,
        action: 'update',
        before: {
          code: before.code,
          default_unit_cost: before.defaultUnitCost,
          default_unit_price: before.defaultUnitPrice,
        },
        after: { code, default_unit_cost: cost, default_unit_price: price },
      });
    },
  );
}

export async function setCostItemActiveCore(
  ctx: OrgContext,
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'update' },
    async (tx, audit) => {
      const [before] = await tx
        .select({ id: costItems.id, active: costItems.active })
        .from(costItems)
        .where(eq(costItems.id, input.id))
        .limit(1);
      if (!before) fail('invalid');

      await tx
        .update(costItems)
        .set({ active: input.active, updatedAt: new Date() })
        .where(eq(costItems.id, input.id));

      await audit({
        entity: 'cost_item',
        entityId: input.id,
        action: 'update',
        before: { active: before.active },
        after: { active: input.active },
      });
    },
  );
}
