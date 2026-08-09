// Seeds two isolated orgs (A and B), each with a row in EVERY org-scoped table,
// so the cross-tenant isolation test has something to leak (and prove it can't).
// Idempotent for the unique-keyed rows; audit rows are append-only and may repeat.
import { sql } from 'drizzle-orm';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { withOrgContext } from '../org-context';
import { auditLog } from '../schema/audit-log';
import { files } from '../schema/files';
import { memberships } from '../schema/memberships';
import { organizations } from '../schema/organizations';
import {
  FILE_A_ID,
  FILE_B_ID,
  ORG_A_ID,
  ORG_B_ID,
  USER_A_ID,
  USER_B_ID,
} from './seed-constants';

interface OrgSeed {
  orgId: string;
  userId: string;
  fileId: string;
  nameAr: string;
  nameEn: string;
}

const orgs: OrgSeed[] = [
  {
    orgId: ORG_A_ID,
    userId: USER_A_ID,
    fileId: FILE_A_ID,
    nameAr: 'شركة ألف للتشطيبات',
    nameEn: 'Org A Fit-out',
  },
  {
    orgId: ORG_B_ID,
    userId: USER_B_ID,
    fileId: FILE_B_ID,
    nameAr: 'شركة باء للتشطيبات',
    nameEn: 'Org B Fit-out',
  },
];

async function seedOrg(db: Parameters<typeof withOrgContext>[0], org: OrgSeed) {
  // Pre-set the org id as context so RLS with_check passes for the very first
  // insert of the org row itself (same pattern onboarding uses).
  await withOrgContext(
    db,
    { orgId: org.orgId, userId: org.userId, role: 'owner' },
    async (tx) => {
      await tx
        .insert(organizations)
        .values({
          id: org.orgId,
          nameAr: org.nameAr,
          nameEn: org.nameEn,
          defaultLocale: 'ar-EG',
        })
        .onConflictDoNothing();

      await tx
        .insert(memberships)
        .values({ orgId: org.orgId, userId: org.userId, role: 'owner' })
        .onConflictDoNothing();

      await tx
        .insert(files)
        .values({
          id: org.fileId,
          orgId: org.orgId,
          entity: 'seed',
          bucket: 'merta-files',
          objectKey: `${org.orgId}/seed/${org.fileId}`,
          originalName: 'seed.txt',
          createdBy: org.userId,
        })
        .onConflictDoNothing();

      // audit_log is append-only; guard against duplicate spam on re-seed.
      const existing = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(sql`${auditLog.entity} = 'organization'`)
        .limit(1);
      if (existing.length === 0) {
        await tx.insert(auditLog).values({
          orgId: org.orgId,
          actorUserId: org.userId,
          entity: 'organization',
          entityId: org.orgId,
          action: 'create',
          before: null,
          after: { name_en: org.nameEn, name_ar: org.nameAr },
        });
      }
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
      console.log(`Seeded org ${org.nameEn} (${org.orgId}).`);
    }
    console.log('Seed complete.');
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
