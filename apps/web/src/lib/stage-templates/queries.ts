import 'server-only';
import { stageTemplates, type StageTemplate } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The org's active stage templates, in process order. ALWAYS available —
 * createProjectCore reads this to seed a new project's stages.
 */
export function listStageTemplates(ctx: OrgContext): Promise<StageTemplate[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(stageTemplates)
      .where(eq(stageTemplates.active, true))
      .orderBy(asc(stageTemplates.sortOrder), asc(stageTemplates.createdAt)),
  );
}
