// A seed client for an org (idempotent on its fixed id). Projects reference it,
// so this MUST run before seedProjects.
import type { MetraDb } from '../client';
import { clients } from '../schema/clients';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedClients(tx: MetraDb, org: OrgSeed): Promise<void> {
  await tx
    .insert(clients)
    .values({
      id: org.clientId,
      orgId: org.orgId,
      nameEn: 'Seed client',
      nameAr: 'عميل تجريبي',
      contactName: 'Seed Contact',
      email: 'client@example.com',
      city: 'Cairo',
    })
    .onConflictDoNothing();
}
