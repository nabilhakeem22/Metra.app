// Variation-order creation: createVariationDraftCore. Opens a DRAFT VO against an
// ISSUED or SIGNED contract and allocates the per-org VO number (VO-YYYY-NNNN).
import { contracts, variationOrders, type MetraDb } from '@metra/db';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { clean } from '@/lib/validation/text';
import { isUuid } from '@/lib/uuid';

export interface CreateVariationDraftInput {
  contractId: string;
  titleAr?: string | null;
  titleEn?: string | null;
  reasonAr?: string | null;
  reasonEn?: string | null;
}

/**
 * Create a DRAFT variation order against an ISSUED or SIGNED contract. Gate
 * variations_draft/create. Allocates the per-org VO number (VO-YYYY-NNNN).
 */
/**
 * The contract this VO changes, refusing one that is not live.
 *
 * A VO against a draft contract has nothing to vary, and one against a terminated
 * contract carries no commercial change.
 */
async function loadLiveContract(
  tx: MetraDb,
  contractId: string,
): Promise<{ projectId: string }> {
  const contract = await requireInOrg(
    tx,
    contracts,
    contractId,
    { status: contracts.status, projectId: contracts.projectId },
    'invalid',
  );
  if (contract.status !== 'issued' && contract.status !== 'signed') {
    fail('contract_not_issued');
  }
  return { projectId: contract.projectId };
}

/** Per-org numbering, serialized by a transaction-scoped advisory lock. */
function allocateVariationNumber(tx: MetraDb, orgId: string): Promise<number> {
  return allocateNumber(tx, orgId, 'variation_orders', 'variation_orders', 'number');
}

/** Insert the draft VO row and return its id. It carries no lines and no money. */
async function persistVariationDraft(
  tx: MetraDb,
  orgId: string,
  number: number,
  contractId: string,
  projectId: string,
  input: CreateVariationDraftInput,
): Promise<string> {
  const [row] = await tx
    .insert(variationOrders)
    .values({
      orgId,
      number,
      contractId,
      projectId,
      titleAr: clean(input.titleAr),
      titleEn: clean(input.titleEn),
      reasonAr: clean(input.reasonAr),
      reasonEn: clean(input.reasonEn),
    })
    .returning({ id: variationOrders.id });
  return row.id;
}

/** The ledger entry a new VO leaves: which number, against which contract. */
function auditVariationCreated(
  audit: (entry: AuditEntry) => Promise<void>,
  variationOrderId: string,
  number: number,
  contractId: string,
): Promise<void> {
  return audit({
    entity: 'variation_order',
    entityId: variationOrderId,
    action: 'create',
    before: null,
    after: { number, contract_id: contractId },
  });
}

export async function createVariationDraftCore(
  ctx: OrgContext,
  input: CreateVariationDraftInput,
): Promise<ActionResult> {
  const contractId = input.contractId?.trim();
  if (!contractId || !isUuid(contractId)) return err('invalid');
  // Bilingual check: a VO needs a title in at least ONE language.
  if (!clean(input.titleAr) && !clean(input.titleEn)) return err('name_required');

  return mutateInOrg(
    ctx,
    { capability: 'variations_draft', action: 'create' },
    async (tx, audit) => {
      const contract = await loadLiveContract(tx, contractId);
      const number = await allocateVariationNumber(tx, ctx.orgId);
      const variationOrderId = await persistVariationDraft(
        tx,
        ctx.orgId,
        number,
        contractId,
        contract.projectId,
        input,
      );
      await auditVariationCreated(audit, variationOrderId, number, contractId);
      return variationOrderId;
    },
  );
}
