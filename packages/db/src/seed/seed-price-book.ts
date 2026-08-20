// Price-book data for a seeded org: the 8 default sections, one cost item under
// the civil section, and an append-only price-change header + line. Idempotent
// (section/item guard on their fixed keys/ids; the price change guards by id).
import { sql } from 'drizzle-orm';
import type { MetraDb } from '../client';
import { costItems } from '../schema/cost-items';
import { priceChangeLines, priceChanges } from '../schema/price-changes';
import { DEFAULT_SECTIONS } from '../schema/section-defaults';
import { sections } from '../schema/sections';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedPriceBook(tx: MetraDb, org: OrgSeed): Promise<void> {
  // The 8 default sections (shared source for Price Book + builder).
  await tx
    .insert(sections)
    .values(
      DEFAULT_SECTIONS.map((s) => ({
        orgId: org.orgId,
        key: s.key,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
      })),
    )
    .onConflictDoNothing();
  const [civilSection] = await tx
    .select({ id: sections.id })
    .from(sections)
    .where(sql`${sections.key} = 'civil'`)
    .limit(1);

  // A price-book cost item (idempotent on its fixed id).
  await tx
    .insert(costItems)
    .values({
      id: org.costItemId,
      orgId: org.orgId,
      code: org.costItemCode,
      nameEn: 'Seed cost item',
      nameAr: 'بند تكلفة تجريبي',
      sectionId: civilSection.id,
      unit: 'sqm',
      defaultUnitCost: '100.0000',
      defaultUnitPrice: '150.0000',
    })
    .onConflictDoNothing();

  // A price-change header + one line (append-only; guard re-seed by id).
  const changeExists = await tx
    .select({ id: priceChanges.id })
    .from(priceChanges)
    .where(sql`${priceChanges.id} = ${org.priceChangeId}`)
    .limit(1);
  if (changeExists.length === 0) {
    await tx.insert(priceChanges).values({
      id: org.priceChangeId,
      orgId: org.orgId,
      category: 'civil',
      pctChange: '10.0000',
      target: 'both',
      effectiveDate: '2026-01-01',
      appliedBy: org.userId,
      itemCount: 1,
    });
    await tx.insert(priceChangeLines).values({
      id: org.priceLineId,
      orgId: org.orgId,
      priceChangeId: org.priceChangeId,
      costItemId: org.costItemId,
      oldUnitCost: '100.0000',
      newUnitCost: '110.0000',
      oldUnitPrice: '150.0000',
      newUnitPrice: '165.0000',
    });
  }
}
