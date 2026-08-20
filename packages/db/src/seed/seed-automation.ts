// Default automation settings for a seeded org. MUST run after the owner
// membership: org_isolation's app_is_current_org_member() second factor requires
// the member to exist first, else this insert is rejected on a fresh DB.
import type { MetraDb } from '../client';
import { automationSettings } from '../schema/automation-settings';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedAutomation(tx: MetraDb, org: OrgSeed): Promise<void> {
  await tx
    .insert(automationSettings)
    .values({ orgId: org.orgId })
    .onConflictDoNothing();
}
