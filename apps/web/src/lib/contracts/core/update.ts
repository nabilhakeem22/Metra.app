// Contract draft edits: saveContractDraftCore. Edits a DRAFT contract's HEADER
// only — lines/totals are the frozen baseline from generation and are never
// touched here. The validation and the column patch live in ./update-header.ts,
// which is pure and therefore unit-testable without a database.
import { contracts } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg, requireInOrg } from '@/lib/actions/mutate';
import type { AuditEntry } from '@/lib/audit';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { isUuid } from '@/lib/uuid';
import { contractHeaderPatch, validateContractHeader } from './update-header';

export interface ContractHeaderInput {
  titleAr?: string | null;
  titleEn?: string | null;
  signatureDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  retentionPct?: string | null;
  retentionReleaseTermsAr?: string | null;
  retentionReleaseTermsEn?: string | null;
  advancePct?: string | null;
  advanceRecoveryMethod?: string | null;
  paymentTermsDays?: number | null;
  paymentScheduleMode?: string | null;
  penaltyAr?: string | null;
  penaltyEn?: string | null;
  defectsLiabilityDays?: number | null;
  scopeInclusionsAr?: string | null;
  scopeInclusionsEn?: string | null;
  scopeExclusionsAr?: string | null;
  scopeExclusionsEn?: string | null;
  termsAr?: string | null;
  termsEn?: string | null;
}

export interface SaveContractDraftInput {
  id: string;
  header: ContractHeaderInput;
}

/** The ledger entry a header edit leaves. The columns themselves are not logged:
 *  a contract header carries commercial terms, and the audit row is queryable. */
function auditContractHeaderSaved(
  audit: (entry: AuditEntry) => Promise<void>,
  contractId: string,
): Promise<void> {
  return audit({
    entity: 'contract',
    entityId: contractId,
    action: 'update',
    before: null,
    after: { header: true },
  });
}

/**
 * Edit a DRAFT contract's header only (lines/totals are the frozen baseline from
 * generation and are never edited here). Rejects a non-draft contract with
 * `contract_not_draft`. Percentages are [0,100]; dates must be well-formed.
 */
export async function saveContractDraftCore(
  ctx: OrgContext,
  input: SaveContractDraftInput,
): Promise<ActionResult> {
  const id = input.id?.trim();
  if (!id || !isUuid(id)) return err('invalid');
  const header = input.header ?? {};
  const validated = validateContractHeader(header);
  if (typeof validated === 'string') return err(validated);

  return mutateInOrg(
    ctx,
    { capability: 'contracts_generate', action: 'update' },
    async (tx, audit) => {
      const row = await requireInOrg(
        tx,
        contracts,
        id,
        { status: contracts.status },
        'invalid',
      );
      if (row.status !== 'draft') fail('contract_not_draft');
      await tx
        .update(contracts)
        .set(contractHeaderPatch(header, validated))
        .where(and(eq(contracts.id, id), eq(contracts.status, 'draft')));
      await auditContractHeaderSaved(audit, id);
    },
  );
}
