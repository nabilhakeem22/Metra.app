// One studio, inside ITS OWN RLS transaction (withOrgContext: metra_app, the
// studio's org and actor in the GUCs): read what the studio has, plan, and,
// unless it is a dry run, insert the sections and cost items with an audit row
// each, shaped as the app's own creates write them (lib/price-book/core.ts,
// lib/sections/core.ts). Inserts only: no studio row is ever updated or
// deleted. RLS, the FKs and every CHECK apply exactly as for the app.
import { withOrgContext, type MetraDb } from '@metra/db';
import { auditLog, costItems, sections } from '@metra/db/schema';
import { sql } from 'drizzle-orm';
import { planSeed, type MarketSeedItem, type SeedPlan } from './plan';

export interface StudioContext {
  orgId: string;
  userId: string;
  role: 'owner' | 'admin';
}

/** Marks every audit row the seed writes, so its creates read apart from a studio's own. */
export const SEED_SOURCE = 'market:seed-price-books';

const auditRow = (entity: 'section' | 'cost_item', entityId: string, after: Record<string, unknown>) => ({
  orgId: sql`current_setting('app.current_org_id', true)::uuid`,
  actorUserId: sql`current_setting('app.current_user_id', true)::uuid`,
  entity,
  entityId,
  action: 'create' as const,
  before: null,
  after: { ...after, source: SEED_SOURCE },
});

async function readBook(tx: MetraDb) {
  return {
    sections: await tx.select({ id: sections.id, key: sections.key, nameAr: sections.nameAr, nameEn: sections.nameEn }).from(sections),
    items: await tx.select({ code: costItems.code, nameAr: costItems.nameAr, nameEn: costItems.nameEn, marketItemId: costItems.marketItemId }).from(costItems),
  };
}

async function writePlan(tx: MetraDb, orgId: string, plan: SeedPlan, existingSections: Array<{ id: string; key: string | null }>): Promise<void> {
  const sectionIds = new Map(existingSections.flatMap((section) => (section.key ? [[section.key, section.id] as [string, string]] : [])));
  if (plan.sectionsToCreate.length > 0) {
    const created = await tx
      .insert(sections)
      .values(plan.sectionsToCreate.map((section) => ({ orgId, key: section.key, nameAr: section.nameAr, nameEn: section.nameEn })))
      .returning({ id: sections.id, key: sections.key, nameAr: sections.nameAr, nameEn: sections.nameEn });
    for (const section of created) sectionIds.set(section.key as string, section.id);
    await tx.insert(auditLog).values(created.map((section) => auditRow('section', section.id, { name_en: section.nameEn, name_ar: section.nameAr, key: section.key })));
  }
  if (plan.itemsToCreate.length === 0) return;
  const items = await tx
    .insert(costItems)
    .values(plan.itemsToCreate.map((item) => ({
      orgId,
      code: item.code,
      nameAr: item.nameAr,
      nameEn: item.nameEn,
      sectionId: sectionIds.get(item.sectionKey) as string,
      unit: item.unit,
      defaultUnitCost: item.defaultUnitCost,
      defaultUnitPrice: item.defaultUnitPrice,
      marketItemId: item.marketItemId,
    })))
    .returning({ id: costItems.id, code: costItems.code, nameAr: costItems.nameAr, nameEn: costItems.nameEn, sectionId: costItems.sectionId, unit: costItems.unit, marketItemId: costItems.marketItemId, cost: costItems.defaultUnitCost, price: costItems.defaultUnitPrice });
  await tx.insert(auditLog).values(items.map((item) => auditRow('cost_item', item.id, {
    code: item.code, nameEn: item.nameEn, nameAr: item.nameAr, section_id: item.sectionId, unit: item.unit,
    market_item_id: item.marketItemId, default_unit_cost: item.cost, default_unit_price: item.price,
  })));
}

/** The studio's plan; written in the same transaction unless `dryRun`. */
export async function seedStudio(db: MetraDb, studio: StudioContext, marketItems: MarketSeedItem[], dryRun: boolean): Promise<SeedPlan> {
  return withOrgContext(db, studio, async (tx) => {
    const book = await readBook(tx);
    const plan = planSeed(marketItems, book);
    if (!dryRun) await writePlan(tx, studio.orgId, plan, book.sections);
    return plan;
  });
}
