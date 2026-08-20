// A seed project referencing the seed client (same org). Idempotent on its fixed
// id; runs after seedClients.
import type { MetraDb } from '../client';
import { projects } from '../schema/projects';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedProjects(tx: MetraDb, org: OrgSeed): Promise<void> {
  await tx
    .insert(projects)
    .values({
      id: org.projectId,
      orgId: org.orgId,
      code: org.projectCode,
      nameEn: 'Seed project',
      nameAr: 'مشروع تجريبي',
      clientId: org.clientId,
      status: 'active',
      city: 'Cairo',
    })
    .onConflictDoNothing();
}
