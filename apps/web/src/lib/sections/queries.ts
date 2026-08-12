import 'server-only';
import { costItems, sections, type Section } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/** Active, org-scoped sections, ordered by name then created. */
export function listSections(ctx: OrgContext): Promise<Section[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(sections)
      .where(eq(sections.active, true))
      .orderBy(asc(sections.nameEn), asc(sections.createdAt)),
  );
}

/** How many cost items reference each section (for the Price Book groups). */
export function countBySection(
  ctx: OrgContext,
): Promise<Array<{ sectionId: string; count: number }>> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        sectionId: costItems.sectionId,
        count: sql<number>`count(*)::int`,
      })
      .from(costItems)
      .groupBy(costItems.sectionId),
  );
}
