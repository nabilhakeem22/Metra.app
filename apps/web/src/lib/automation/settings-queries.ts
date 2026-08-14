import 'server-only';
import { automationSettings, type AutomationSettings } from '@metra/db';
import { eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

/**
 * The caller org's automation settings row (one per org, guaranteed by the 0016
 * backfill + org-creation seed). Returns null only if the row is somehow absent;
 * the settings page then falls back to schema defaults.
 */
export async function getAutomationSettings(
  ctx: OrgContext,
): Promise<AutomationSettings | null> {
  const [row] = await withOrgContext(ctx, (tx) =>
    tx
      .select()
      .from(automationSettings)
      .where(eq(automationSettings.orgId, ctx.orgId))
      .limit(1),
  );
  return row ?? null;
}
