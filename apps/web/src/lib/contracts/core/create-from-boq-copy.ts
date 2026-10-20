import 'server-only';
// The deep copy at the heart of an execution contract: an issued BOQ's sections
// and lines become the contract's baseline, value for value, its item codes
// and provisional flags included.
//
// NOTHING IS RECOMPUTED, and NOTHING IS COPIED ROW BY ROW IN JAVASCRIPT. The
// sections go in one insert (their RETURNING order is the input order, which
// is what builds the old -> new id map), and every line goes in ONE
// `INSERT ... SELECT` from boq_lines joined to that map as a VALUES list. A
// 2,000-line BOQ costs the Worker the same as a 20-line one: the rows never
// cross the wire (plan A25, AC37).
import { boqSections, contractSections, type MetraDb } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';

interface CopyTarget {
  orgId: string;
  boqId: string;
  contractId: string;
}

/** Copy the sections, and return each old section id with its new one. */
async function copyBoqSections(tx: MetraDb, target: CopyTarget): Promise<Array<[string, string]>> {
  const oldSections = await tx
    .select({
      id: boqSections.id,
      titleAr: boqSections.titleAr,
      titleEn: boqSections.titleEn,
      sortOrder: boqSections.sortOrder,
      sectionSubtotal: boqSections.sectionSubtotal,
    })
    .from(boqSections)
    .where(eq(boqSections.boqId, target.boqId))
    .orderBy(asc(boqSections.sortOrder), asc(boqSections.id));
  if (oldSections.length === 0) return [];

  const newSections = await tx
    .insert(contractSections)
    .values(
      oldSections.map((section) => ({
        orgId: target.orgId,
        contractId: target.contractId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.sectionSubtotal,
      })),
    )
    .returning({ id: contractSections.id });
  return oldSections.map((section, index) => [section.id, newSections[index].id]);
}

/** Every line of the BOQ onto its new section, in one statement. */
async function copyBoqLines(
  tx: MetraDb,
  target: CopyTarget,
  sectionMap: Array<[string, string]>,
): Promise<void> {
  const mapRows = sql.join(
    sectionMap.map(([oldId, newId]) => sql`(${oldId}::uuid, ${newId}::uuid)`),
    sql`, `,
  );
  await tx.execute(sql`
    insert into public.contract_lines
      (org_id, contract_id, section_id, cost_item_id, item_code, description_ar, description_en,
       qty, unit, unit_cost, unit_price, discount_pct, line_cost, line_total, line_margin,
       provisional, sort_order)
    select ${target.orgId}::uuid, ${target.contractId}::uuid, section_map.new_id, l.cost_item_id,
           l.item_code, l.description_ar, l.description_en, l.qty, l.unit, l.unit_cost,
           l.unit_price, l.discount_pct, l.line_cost, l.line_total, l.line_margin,
           l.provisional, l.sort_order
      from public.boq_lines l
      join (values ${mapRows}) as section_map (old_id, new_id) on section_map.old_id = l.section_id
     where l.org_id = ${target.orgId}::uuid and l.boq_id = ${target.boqId}::uuid
  `);
}

/**
 * Copy every section and line of the BOQ onto the contract. A BOQ with no
 * sections is a no-op: every line hangs off a section.
 */
export async function copyBoqContentToContract(tx: MetraDb, target: CopyTarget): Promise<void> {
  const sectionMap = await copyBoqSections(tx, target);
  if (sectionMap.length === 0) return;
  await copyBoqLines(tx, target, sectionMap);
}
