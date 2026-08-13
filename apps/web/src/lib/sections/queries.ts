import 'server-only';
import { sections, type Section } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
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
