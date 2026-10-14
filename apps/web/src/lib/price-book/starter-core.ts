// The opt-in starter catalogue: the ~40 items a new studio can begin from.
import { costItems, sections } from '@metra/db';
import { mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { STARTER_CATALOGUE } from './starter-catalogue';

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
      // Map each starter item's category KEY to this org's section id.
      const orgSections = await tx
        .select({ id: sections.id, key: sections.key })
        .from(sections);
      const sectionByKey = new Map(
        orgSections.filter((s) => s.key).map((s) => [s.key as string, s.id]),
      );

      const rows = STARTER_CATALOGUE.flatMap((it) => {
        const sectionId = sectionByKey.get(it.category);
        return sectionId
          ? [
              {
                orgId: ctx.orgId,
                code: it.code,
                nameEn: it.nameEn,
                nameAr: it.nameAr,
                sectionId,
                unit: it.unit,
                defaultUnitCost: it.defaultUnitCost,
                defaultUnitPrice: it.defaultUnitPrice,
              },
            ]
          : [];
      });
      const inserted = rows.length
        ? await tx
            .insert(costItems)
            .values(rows)
            .onConflictDoNothing({ target: [costItems.orgId, costItems.code] })
            .returning({ id: costItems.id })
        : [];

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
