// Seeds two isolated orgs (A and B), each with a row in EVERY org-scoped table,
// so the cross-tenant isolation test has something to leak (and prove it can't).
// Idempotent for the unique-keyed rows; audit rows are append-only and may repeat.
import { sql } from 'drizzle-orm';
import { createDb } from '../client';
import { MIGRATION_DATABASE_URL } from '../env';
import { withOrgContext } from '../org-context';
import { auditLog } from '../schema/audit-log';
import { clients } from '../schema/clients';
import { contractEvents } from '../schema/contract-events';
import { contractLines } from '../schema/contract-lines';
import { contractSections } from '../schema/contract-sections';
import { contracts } from '../schema/contracts';
import { costItems } from '../schema/cost-items';
import { files } from '../schema/files';
import { invitations } from '../schema/invitations';
import { memberships } from '../schema/memberships';
import { automationSettings } from '../schema/automation-settings';
import { organizations } from '../schema/organizations';
import { priceChangeLines, priceChanges } from '../schema/price-changes';
import { proposalLines } from '../schema/proposal-lines';
import { proposalSections } from '../schema/proposal-sections';
import { proposals } from '../schema/proposals';
import { projects } from '../schema/projects';
import { DEFAULT_SECTIONS } from '../schema/section-defaults';
import { sections } from '../schema/sections';
import { variationOrderEvents } from '../schema/variation-order-events';
import { variationOrderLines } from '../schema/variation-order-lines';
import { variationOrders } from '../schema/variation-orders';
import {
  CLIENT_A_ID,
  CLIENT_B_ID,
  CONTRACT_A_ID,
  CONTRACT_B_ID,
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
  PROPOSAL_A_ID,
  PROPOSAL_B_ID,
  USER_A_ID,
  USER_B_ID,
  VARIATION_A_ID,
  VARIATION_B_ID,
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
  proposalId: string;
  contractId: string;
  variationId: string;
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
    proposalId: PROPOSAL_A_ID,
    contractId: CONTRACT_A_ID,
    variationId: VARIATION_A_ID,
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
    proposalId: PROPOSAL_B_ID,
    contractId: CONTRACT_B_ID,
    variationId: VARIATION_B_ID,
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

      // Default automation settings — MUST come after the owner membership:
      // org_isolation's app_is_current_org_member() second factor requires the
      // member to exist first, else this insert is rejected on a fresh DB.
      await tx
        .insert(automationSettings)
        .values({ orgId: org.orgId })
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

/**
 * Seed an accepted-proposal -> contract -> variation-order chain so the isolation
 * gate has rows in every P1-Slice-4 table to prove it can't leak. Idempotent:
 * guarded on the fixed contract id. Uses money strings the totals engine would
 * produce (single lump-sum line of 1000 EGP; a +500 VO delta).
 */
async function seedContractChain(
  db: Parameters<typeof withOrgContext>[0],
  org: OrgSeed,
) {
  await withOrgContext(
    db,
    { orgId: org.orgId, userId: org.userId, role: 'owner' },
    async (tx) => {
      const exists = await tx
        .select({ id: contracts.id })
        .from(contracts)
        .where(sql`${contracts.id} = ${org.contractId}`)
        .limit(1);
      if (exists.length) return;

      // 1) An accepted proposal (draft first so the child-draft guard permits the
      //    section/line inserts, then flip to accepted while still unlocked).
      await tx.insert(proposals).values({
        id: org.proposalId,
        orgId: org.orgId,
        number: 9001,
        titleEn: 'Seed accepted proposal',
        titleAr: 'عرض مقبول تجريبي',
        clientId: org.clientId,
        projectId: org.projectId,
        status: 'draft',
        subtotal: '1000.0000',
        taxableBase: '1000.0000',
        taxAmount: '140.0000',
        total: '1140.0000',
      });
      const [pSec] = await tx
        .insert(proposalSections)
        .values({
          orgId: org.orgId,
          proposalId: org.proposalId,
          titleEn: 'Works',
          sectionSubtotal: '1000.0000',
        })
        .returning({ id: proposalSections.id });
      await tx.insert(proposalLines).values({
        orgId: org.orgId,
        proposalId: org.proposalId,
        sectionId: pSec.id,
        descriptionEn: 'Seed line',
        qty: '1',
        unit: 'lump_sum',
        unitPrice: '1000.0000',
        lineTotal: '1000.0000',
      });
      await tx
        .update(proposals)
        .set({ status: 'accepted' })
        .where(sql`${proposals.id} = ${org.proposalId}`);

      // 2) The generated contract (draft), with a snapshot section + line + event.
      await tx.insert(contracts).values({
        id: org.contractId,
        orgId: org.orgId,
        number: 1,
        titleEn: 'Seed contract',
        titleAr: 'عقد تجريبي',
        sourceProposalId: org.proposalId,
        clientId: org.clientId,
        projectId: org.projectId,
        status: 'draft',
        originalValue: '1140.0000',
        subtotal: '1000.0000',
        taxableBase: '1000.0000',
        taxAmount: '140.0000',
      });
      const [cSec] = await tx
        .insert(contractSections)
        .values({
          orgId: org.orgId,
          contractId: org.contractId,
          titleEn: 'Works',
          sectionSubtotal: '1000.0000',
        })
        .returning({ id: contractSections.id });
      await tx.insert(contractLines).values({
        orgId: org.orgId,
        contractId: org.contractId,
        sectionId: cSec.id,
        descriptionEn: 'Seed line',
        qty: '1',
        unit: 'lump_sum',
        unitPrice: '1000.0000',
        lineTotal: '1000.0000',
      });
      await tx.insert(contractEvents).values({
        orgId: org.orgId,
        contractId: org.contractId,
        kind: 'generated',
        actorUserId: org.userId,
        fromStatus: null,
        toStatus: 'draft',
      });

      // 3) A draft variation order with a +500 delta line + a created event.
      await tx.insert(variationOrders).values({
        id: org.variationId,
        orgId: org.orgId,
        number: 1,
        contractId: org.contractId,
        projectId: org.projectId,
        status: 'draft',
        titleEn: 'Seed variation',
        titleAr: 'أمر تغيير تجريبي',
        netDelta: '500.0000',
      });
      await tx.insert(variationOrderLines).values({
        orgId: org.orgId,
        variationOrderId: org.variationId,
        descriptionEn: 'Extra scope',
        qty: '1',
        unit: 'lump_sum',
        unitPrice: '500.0000',
        lineTotal: '500.0000',
      });
      await tx.insert(variationOrderEvents).values({
        orgId: org.orgId,
        variationOrderId: org.variationId,
        kind: 'created',
        actorUserId: org.userId,
        fromStatus: null,
        toStatus: 'draft',
      });
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
