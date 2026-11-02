// The deep copy behind a new BOQ version: the same shape as the contract's copy
// (lib/contracts/core/create-from-boq-copy.ts). The sections go in one insert,
// whose RETURNING order is the input order and builds the old -> new id map, and
// every line goes in ONE `INSERT ... SELECT`, so a 2,000-line BOQ costs the Worker
// what a 20-line one does. Cost columns are copied as they are: who may read them
// is decided where they are read (../queries/detail.ts).
import { boqSections, type MetraDb } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';

interface CopyTarget {
  orgId: string;
  fromBoqId: string;
  toBoqId: string;
}

async function copySections(tx: MetraDb, target: CopyTarget): Promise<Array<[string, string]>> {
  const oldSections = await tx
    .select({
      id: boqSections.id,
      titleAr: boqSections.titleAr,
      titleEn: boqSections.titleEn,
      sortOrder: boqSections.sortOrder,
      sectionSubtotal: boqSections.sectionSubtotal,
    })
    .from(boqSections)
    .where(eq(boqSections.boqId, target.fromBoqId))
    .orderBy(asc(boqSections.sortOrder), asc(boqSections.id));
  if (oldSections.length === 0) return [];
  const newSections = await tx
    .insert(boqSections)
    .values(
      oldSections.map((section) => ({
        orgId: target.orgId,
        boqId: target.toBoqId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })),
    )
    .returning({ id: boqSections.id });
  return oldSections.map((section, index) => [section.id, newSections[index].id]);
}

async function copyLines(tx: MetraDb, target: CopyTarget, sectionMap: Array<[string, string]>): Promise<void> {
  const mapRows = sql.join(
    sectionMap.map(([oldId, newId]) => sql`(${oldId}::uuid, ${newId}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`
    insert into public.boq_lines
      (org_id, boq_id, section_id, cost_item_id, item_code, description_ar, description_en,
       qty, unit, unit_cost, unit_price, discount_pct, line_cost, line_total, line_margin,
       provisional, sort_order)
    select ${target.orgId}::uuid, ${target.toBoqId}::uuid, section_map.new_id, l.cost_item_id,
           l.item_code, l.description_ar, l.description_en, l.qty, l.unit, l.unit_cost,
           l.unit_price, l.discount_pct, l.line_cost, l.line_total, l.line_margin,
           l.provisional, l.sort_order
      from public.boq_lines l
      join (values ${mapRows}) as section_map (old_id, new_id) on section_map.old_id = l.section_id
     where l.org_id = ${target.orgId}::uuid and l.boq_id = ${target.fromBoqId}::uuid
  `);
}

/** Every section and line of one BOQ onto another. A BOQ with no sections is a no-op. */
export async function copyBoqContent(tx: MetraDb, target: CopyTarget): Promise<void> {
  const sectionMap = await copySections(tx, target);
  if (sectionMap.length === 0) return;
  await copyLines(tx, target, sectionMap);
}
