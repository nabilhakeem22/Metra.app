// PURE price-book CRUD cores — no next/*, no getSessionUser, no cookies. Take an
// OrgContext + validated input; the 'use server' wrappers in ./actions do the
// session/requireOrg work and delegate. Exercised directly by *.dbtest.ts.
import { costItems } from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { ConstraintRefusal } from '@/lib/actions/mutation-failure';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { costItemColumns, requireWritable } from './cost-item-write';
import type { CostItemInput } from './fields';

export type { CostItemInput } from './fields';

/** A race the read checks in requireWritable can lose, or a CHECK the typed-
 *  value rules already enforce, each answered under its own field. */
const COST_ITEM_REFUSALS = [
  { constraint: 'cost_items_org_id_code_unique', field: 'code', error: { code: 'code_taken' } },
  {
    constraint: 'cost_items_section_same_org_fk',
    field: 'sectionId',
    error: { code: 'no_longer_exists' },
  },
  {
    constraint: 'cost_items_default_unit_cost_nonneg',
    field: 'defaultUnitCost',
    error: { code: 'not_negative' },
  },
  {
    constraint: 'cost_items_default_unit_price_nonneg',
    field: 'defaultUnitPrice',
    error: { code: 'not_negative' },
  },
] as const satisfies readonly ConstraintRefusal[];

export async function createCostItemCore(
  ctx: OrgContext,
  input: CostItemInput,
): Promise<ActionResult> {
  const read = costItemColumns(input);
  if ('refusal' in read) return read.refusal;
  const { columns } = read;

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'create', refusals: COST_ITEM_REFUSALS },
    async (tx, audit) => {
      await requireWritable(tx, columns);
      const [row] = await tx
        .insert(costItems)
        .values({ orgId: ctx.orgId, ...columns })
        .returning({ id: costItems.id });

      await audit({
        entity: 'cost_item',
        entityId: row.id,
        action: 'create',
        before: null,
        after: {
          code: columns.code,
          nameEn: columns.nameEn,
          nameAr: columns.nameAr,
          section_id: columns.sectionId,
          unit: columns.unit,
        },
      });
      return row.id;
    },
  );
}

export async function updateCostItemCore(
  ctx: OrgContext,
  input: { id: string } & CostItemInput,
): Promise<ActionResult> {
  const read = costItemColumns(input);
  if ('refusal' in read) return read.refusal;
  const { columns } = read;

  return mutateInOrg(
    ctx,
    { capability: 'price_book', action: 'update', refusals: COST_ITEM_REFUSALS },
    async (tx, audit) => {
      const [before] = await tx
        .select()
        .from(costItems)
        .where(eq(costItems.id, input.id))
        .limit(1);
      if (!before) fail('record_not_found');
      await requireWritable(tx, { ...columns, exceptId: input.id });

      await tx
        .update(costItems)
        .set({ ...columns, updatedAt: new Date() })
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
        after: {
          code: columns.code,
          default_unit_cost: columns.defaultUnitCost,
          default_unit_price: columns.defaultUnitPrice,
        },
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
      const before = await requireInOrg(
        tx,
        costItems,
        input.id,
        { id: costItems.id, active: costItems.active },
        'record_not_found',
      );

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
