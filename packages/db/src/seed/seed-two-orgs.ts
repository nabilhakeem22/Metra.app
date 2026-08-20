// Seeds two isolated orgs (A and B), each with a row in EVERY org-scoped table,
// so the cross-tenant isolation test has something to leak (and prove it can't).
// Idempotent for the unique-keyed rows; audit rows are append-only and may repeat.
// This is the orchestrator: per-domain inserts live in the seed-* helper modules.
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { withOrgContext } from '../org-context';
import { memberships } from '../schema/memberships';
import { seedAutomation } from './seed-automation';
import { seedClients } from './seed-clients';
import { seedContractChain } from './seed-contract-chain';
import { ORG_B_ID, USER_A_ID, USER_B_ID } from './seed-constants';
import { orgs, type OrgSeed } from './seed-org-fixtures';
import { seedOrgFoundation } from './seed-org-foundation';
import { seedPriceBook } from './seed-price-book';
import { seedProjects } from './seed-projects';

async function seedOrg(db: Parameters<typeof withOrgContext>[0], org: OrgSeed) {
  // Pre-set the org id as context so RLS with_check passes for the very first
  // insert of the org row itself (same pattern onboarding uses).
  await withOrgContext(
    db,
    { orgId: org.orgId, userId: org.userId, role: 'owner' },
    async (tx) => {
      await seedOrgFoundation(tx, org);
      await seedAutomation(tx, org);
      await seedPriceBook(tx, org);
      await seedClients(tx, org);
      await seedProjects(tx, org);
    },
  );
}

async function main() {
  const { db, sql: pg } = createDb(MIGRATION_DATABASE_URL(), {
    max: 1,
    prepare: true,
  });
  try {
    for (const org of orgs) {
      await seedOrg(db, org);
      await seedContractChain(db, org);
      console.log(`Seeded org ${org.nameEn} (${org.orgId}).`);
    }

    // Multi-org user: USER_A is ALSO a member of org B (as viewer). This is the
    // exact cross-tenant leak scenario the isolation test must catch — under
    // org A's context, USER_A must NOT see this org B membership row.
    await withOrgContext(
      db,
      { orgId: ORG_B_ID, userId: USER_B_ID, role: 'owner' },
      (tx) =>
        tx
          .insert(memberships)
          .values({ orgId: ORG_B_ID, userId: USER_A_ID, role: 'viewer' })
          .onConflictDoNothing(),
    );
    console.log(`Cross-membership: USER_A added to org B (viewer).`);

    console.log('Seed complete.');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
