// Seeds two isolated orgs (A and B), each with a row in EVERY org-scoped table,
// so the cross-tenant isolation test has something to leak (and prove it can't).
// Idempotent for the unique-keyed rows; audit rows are append-only and may repeat.
import { sql } from 'drizzle-orm';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { withOrgContext } from '../org-context';
import { auditLog } from '../schema/audit-log';
import { clients } from '../schema/clients';
import { costItems } from '../schema/cost-items';
import { files } from '../schema/files';
import { invitations } from '../schema/invitations';
import { memberships } from '../schema/memberships';
import { automationSettings } from '../schema/automation-settings';
import { organizations } from '../schema/organizations';
import { priceChangeLines, priceChanges } from '../schema/price-changes';
import { projects } from '../schema/projects';
import { DEFAULT_SECTIONS } from '../schema/section-defaults';
import { sections } from '../schema/sections';
import {
  CLIENT_A_ID,
  CLIENT_B_ID,
  COST_ITEM_A_ID,
  COST_ITEM_B_ID,
  FILE_A_ID,
  FILE_B_ID,
  INVITE_A_ID,
  INVITE_B_ID,
  ORG_A_ID,
  ORG_B_ID,
  PRICE_CHANGE_A_ID,
  PRICE_CHANGE_B_ID,
  PRICE_LINE_A_ID,
  PRICE_LINE_B_ID,
  PROJECT_A_ID,
  PROJECT_B_ID,
  USER_A_ID,
  USER_B_ID,
} from './seed-constants';

interface OrgSeed {
  orgId: string;
  userId: string;
  fileId: string;
  inviteId: string;
  inviteEmail: string;
  inviteTokenHash: string;
  nameAr: string;
  nameEn: string;
  costItemId: string;
  priceChangeId: string;
  priceLineId: string;
  costItemCode: string;
  clientId: string;
  projectId: string;
  projectCode: string;
}

const orgs: OrgSeed[] = [
  {
    orgId: ORG_A_ID,
    userId: USER_A_ID,
    fileId: FILE_A_ID,
    inviteId: INVITE_A_ID,
    inviteEmail: 'invitee-a@example.com',
    inviteTokenHash: 'seed-token-hash-a',
    nameAr: 'شركة ألف للتشطيبات',
    nameEn: 'Org A Fit-out',
    costItemId: COST_ITEM_A_ID,
    priceChangeId: PRICE_CHANGE_A_ID,
    priceLineId: PRICE_LINE_A_ID,
    costItemCode: 'SEED-A-001',
    clientId: CLIENT_A_ID,
    projectId: PROJECT_A_ID,
    projectCode: 'PRJ-A-001',
  },
  {
    orgId: ORG_B_ID,
    userId: USER_B_ID,
    fileId: FILE_B_ID,
    inviteId: INVITE_B_ID,
    inviteEmail: 'invitee-b@example.com',
    inviteTokenHash: 'seed-token-hash-b',
    nameAr: 'شركة باء للتشطيبات',
    nameEn: 'Org B Fit-out',
    costItemId: COST_ITEM_B_ID,
    priceChangeId: PRICE_CHANGE_B_ID,
    priceLineId: PRICE_LINE_B_ID,
    costItemCode: 'SEED-B-001',
    clientId: CLIENT_B_ID,
    projectId: PROJECT_B_ID,
    projectCode: 'PRJ-B-001',
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

      // Default automation settings (mirrors createOrgCore + the 0016 backfill).
      await tx
        .insert(automationSettings)
        .values({ orgId: org.orgId })
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
          bucket: 'metra-files',
          objectKey: `${org.orgId}/seed/${org.fileId}`,
          originalName: 'seed.txt',
          createdBy: org.userId,
        })
        .onConflictDoNothing();

      await tx
        .insert(invitations)
        .values({
          id: org.inviteId,
          orgId: org.orgId,
          email: org.inviteEmail,
          role: 'admin',
          tokenHash: org.inviteTokenHash,
          status: 'pending',
          invitedBy: org.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();

      // The 8 default sections (shared source for Price Book + builder).
      await tx
        .insert(sections)
        .values(
          DEFAULT_SECTIONS.map((s) => ({
            orgId: org.orgId,
            key: s.key,
            nameEn: s.nameEn,
            nameAr: s.nameAr,
          })),
        )
        .onConflictDoNothing();
      const [civilSection] = await tx
        .select({ id: sections.id })
        .from(sections)
        .where(sql`${sections.key} = 'civil'`)
        .limit(1);

      // A price-book cost item (idempotent on its fixed id).
      await tx
        .insert(costItems)
        .values({
          id: org.costItemId,
          orgId: org.orgId,
          code: org.costItemCode,
          nameEn: 'Seed cost item',
          nameAr: 'بند تكلفة تجريبي',
          sectionId: civilSection.id,
          unit: 'sqm',
          defaultUnitCost: '100.0000',
          defaultUnitPrice: '150.0000',
        })
        .onConflictDoNothing();

      // A client + a project referencing that client (same org).
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

      // A price-change header + one line (append-only; guard re-seed by id).
      const changeExists = await tx
        .select({ id: priceChanges.id })
        .from(priceChanges)
        .where(sql`${priceChanges.id} = ${org.priceChangeId}`)
        .limit(1);
      if (changeExists.length === 0) {
        await tx.insert(priceChanges).values({
          id: org.priceChangeId,
          orgId: org.orgId,
          category: 'civil',
          pctChange: '10.0000',
          target: 'both',
          effectiveDate: '2026-01-01',
          appliedBy: org.userId,
          itemCount: 1,
        });
        await tx.insert(priceChangeLines).values({
          id: org.priceLineId,
          orgId: org.orgId,
          priceChangeId: org.priceChangeId,
          costItemId: org.costItemId,
          oldUnitCost: '100.0000',
          newUnitCost: '110.0000',
          oldUnitPrice: '150.0000',
          newUnitPrice: '165.0000',
        });
      }

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
