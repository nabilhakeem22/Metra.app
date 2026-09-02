// Contract generation: generateContractCore. Deep-copies an ACCEPTED proposal's
// sections, lines and FROZEN totals into a new DRAFT contract — the server never
// recomputes them here (the contract baseline must equal the accepted quote to
// the piastre).
import {
  contractLines,
  contractSections,
  contracts,
  proposalLines,
  proposalSections,
  proposals,
  clients,
  projects,
} from '@metra/db';
import { eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import { chunk, LINE_INSERT_CHUNK } from '@/lib/proposals/core';
import { isUuid } from '@/lib/uuid';

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === UNIQUE_VIOLATION
  );
}

export interface GenerateContractInput {
  proposalId: string;
}

/**
 * Generate a DRAFT contract from an ACCEPTED proposal: deep-copy its sections,
 * lines and totals; `originalValue` = the accepted proposal total (to the
 * piastre). One contract per proposal (unique (org_id, source_proposal_id)); a
 * second attempt returns `contract_exists` and writes no row. Retention/advance
 * inherit project -> client -> 0 (A4: 0 when unset; no industry seed values).
 */
export async function generateContractCore(
  ctx: OrgContext,
  input: GenerateContractInput,
): Promise<ActionResult> {
  const proposalId = input.proposalId?.trim();
  if (!proposalId || !isUuid(proposalId)) return err('invalid');

  return mutateInOrg(
    ctx,
    { capability: 'contracts_generate', action: 'create' },
    async (tx, audit) => {
      const [proposal] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.id, proposalId))
        .limit(1);
      if (!proposal) fail('invalid');
      if (proposal.status !== 'accepted') fail('proposal_not_accepted');

      // Fast path for the common duplicate case (AC2). The unique index is the
      // real race guard, caught below.
      const existing = await tx
        .select({ id: contracts.id })
        .from(contracts)
        .where(eq(contracts.sourceProposalId, proposalId))
        .limit(1);
      if (existing[0]) fail('contract_exists');

      // Retention/advance inherit project -> client -> 0.
      const [project] = await tx
        .select({
          advancePct: projects.advancePct,
          retentionPct: projects.retentionPct,
        })
        .from(projects)
        .where(eq(projects.id, proposal.projectId))
        .limit(1);
      const [client] = await tx
        .select({
          advancePct: clients.advancePct,
          retentionPct: clients.retentionPct,
        })
        .from(clients)
        .where(eq(clients.id, proposal.clientId))
        .limit(1);
      const advancePct =
        pickPct(project?.advancePct) ?? pickPct(client?.advancePct) ?? '0';
      const retentionPct =
        pickPct(project?.retentionPct) ?? pickPct(client?.retentionPct) ?? '0';

      const number = await allocateNumber(
        tx,
        ctx.orgId,
        'contracts',
        'contracts',
        'number',
      );

      let insertedId: string;
      try {
        const [row] = await tx
          .insert(contracts)
          .values({
            orgId: ctx.orgId,
            number,
            // The source proposal always carries a title (bilingualCheck), so the
            // snapshot satisfies the contract's own present-check; fall back to
            // the display number only in the impossible both-null case.
            titleAr: proposal.titleAr,
            titleEn:
              proposal.titleAr || proposal.titleEn
                ? proposal.titleEn
                : formatDocNumber(
                    'C',
                    number,
                    new Date(proposal.createdAt).getFullYear(),
                  ),
            sourceProposalId: proposalId,
            clientId: proposal.clientId,
            projectId: proposal.projectId,
            currency: proposal.currency,
            advancePct,
            retentionPct,
            originalValue: proposal.total,
            discountPct: proposal.discountPct,
            taxRate: proposal.taxRate,
            supervisionPct: proposal.supervisionPct,
            subtotal: proposal.subtotal,
            discountAmount: proposal.discountAmount,
            taxableBase: proposal.taxableBase,
            taxAmount: proposal.taxAmount,
            supervisionAmount: proposal.supervisionAmount,
            totalCost: proposal.totalCost,
            totalMargin: proposal.totalMargin,
          })
          .returning({ id: contracts.id });
        insertedId = row.id;
      } catch (e) {
        // Lost the race for (org_id, source_proposal_id): one contract already exists.
        if (isUniqueViolation(e)) fail('contract_exists');
        throw e;
      }

      // Deep-copy sections + lines (batched, no N+1).
      const oldSections = await tx
        .select()
        .from(proposalSections)
        .where(eq(proposalSections.proposalId, proposalId))
        .orderBy(proposalSections.sortOrder);
      if (oldSections.length) {
        const newSecs = await tx
          .insert(contractSections)
          .values(
            oldSections.map((s) => ({
              orgId: ctx.orgId,
              contractId: insertedId,
              titleAr: s.titleAr,
              titleEn: s.titleEn,
              sortOrder: s.sortOrder,
              sectionSubtotal: s.sectionSubtotal,
            })),
          )
          .returning({ id: contractSections.id });
        const idMap = new Map(oldSections.map((s, i) => [s.id, newSecs[i].id]));

        const oldLines = await tx
          .select()
          .from(proposalLines)
          .where(eq(proposalLines.proposalId, proposalId));
        const newLineRows = oldLines.map((l) => ({
          orgId: ctx.orgId,
          contractId: insertedId,
          sectionId: idMap.get(l.sectionId)!,
          costItemId: l.costItemId,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          qty: l.qty,
          unit: l.unit,
          unitCost: l.unitCost,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          lineCost: l.lineCost,
          lineTotal: l.lineTotal,
          lineMargin: l.lineMargin,
          sortOrder: l.sortOrder,
        }));
        for (const part of chunk(newLineRows, LINE_INSERT_CHUNK)) {
          await tx.insert(contractLines).values(part);
        }
      }

      await audit({
        entity: 'contract',
        entityId: insertedId,
        action: 'create',
        before: null,
        after: { number, source_proposal_id: proposalId },
      });
      return insertedId;
    },
  );
}

/** A configured (non-null) percentage, or undefined so the caller can fall back. */
function pickPct(v: string | null | undefined): string | undefined {
  return v ?? undefined;
}
