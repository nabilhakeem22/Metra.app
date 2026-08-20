// Seed an accepted-proposal -> contract -> variation-order chain so the isolation
// gate has rows in every P1-Slice-4 table to prove it can't leak. Idempotent:
// guarded on the fixed contract id. Uses money strings the totals engine would
// produce (single lump-sum line of 1000 EGP; a +500 VO delta). Opens its own
// org-scoped transaction (a second txn, distinct from the foundation seed).
import { sql } from 'drizzle-orm';
import type { MetraDb } from '../client';
import { withOrgContext } from '../org-context';
import { contractEvents } from '../schema/contract-events';
import { contractLines } from '../schema/contract-lines';
import { contractSections } from '../schema/contract-sections';
import { contracts } from '../schema/contracts';
import { proposalLines } from '../schema/proposal-lines';
import { proposalSections } from '../schema/proposal-sections';
import { proposals } from '../schema/proposals';
import { variationOrderEvents } from '../schema/variation-order-events';
import { variationOrderLines } from '../schema/variation-order-lines';
import { variationOrders } from '../schema/variation-orders';
import type { OrgSeed } from './seed-org-fixtures';

export async function seedContractChain(
  db: MetraDb,
  org: OrgSeed,
): Promise<void> {
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
