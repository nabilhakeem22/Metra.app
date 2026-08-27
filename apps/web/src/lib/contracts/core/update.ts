// Contract draft edits: saveContractDraftCore. Edits a DRAFT contract's HEADER
// only — lines/totals are the frozen baseline from generation and are never
// touched here.
import { contracts } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import {
  normalizeMoney,
  normalizeText,
  pctInRange,
  validIsoDate,
} from '@/lib/proposals/core';
import { UUID_RE } from './shared';

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
  if (!id || !UUID_RE.test(id)) return err('invalid');
  const h = input.header ?? {};

  const retentionPct = h.retentionPct != null ? normalizeMoney(h.retentionPct) : undefined;
  const advancePct = h.advancePct != null ? normalizeMoney(h.advancePct) : undefined;
  if (retentionPct === null || (retentionPct !== undefined && !pctInRange(retentionPct))) {
    return err('invalid_percentage');
  }
  if (advancePct === null || (advancePct !== undefined && !pctInRange(advancePct))) {
    return err('invalid_percentage');
  }
  const signatureDate = normalizeText(h.signatureDate);
  const startDate = normalizeText(h.startDate);
  const endDate = normalizeText(h.endDate);
  for (const d of [signatureDate, startDate, endDate]) {
    if (d && !validIsoDate(d)) return err('invalid_date');
  }
  if (startDate && endDate && endDate < startDate) return err('invalid_dates');

  return mutateInOrg(
    ctx,
    { capability: 'contracts_generate', action: 'update' },
    async (tx, audit) => {
      const [row] = await tx
        .select({ status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, id))
        .limit(1);
      if (!row) fail('invalid');
      if (row.status !== 'draft') fail('contract_not_draft');

      // Only touch fields the caller actually provided (`undefined` = leave as-is).
      // Nulling title_ar + title_en unconditionally would trip the bilingual CHECK.
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (h.titleAr !== undefined) set.titleAr = normalizeText(h.titleAr);
      if (h.titleEn !== undefined) set.titleEn = normalizeText(h.titleEn);
      if (h.signatureDate !== undefined) set.signatureDate = signatureDate;
      if (h.startDate !== undefined) set.startDate = startDate;
      if (h.endDate !== undefined) set.endDate = endDate;
      if (retentionPct !== undefined) set.retentionPct = retentionPct;
      if (h.retentionReleaseTermsAr !== undefined)
        set.retentionReleaseTermsAr = normalizeText(h.retentionReleaseTermsAr);
      if (h.retentionReleaseTermsEn !== undefined)
        set.retentionReleaseTermsEn = normalizeText(h.retentionReleaseTermsEn);
      if (advancePct !== undefined) set.advancePct = advancePct;
      if (h.advanceRecoveryMethod != null)
        set.advanceRecoveryMethod = h.advanceRecoveryMethod.trim() || 'prorata';
      if (h.paymentTermsDays !== undefined) set.paymentTermsDays = h.paymentTermsDays;
      if (h.paymentScheduleMode != null)
        set.paymentScheduleMode = h.paymentScheduleMode.trim() || 'milestone';
      if (h.penaltyAr !== undefined) set.penaltyAr = normalizeText(h.penaltyAr);
      if (h.penaltyEn !== undefined) set.penaltyEn = normalizeText(h.penaltyEn);
      if (h.defectsLiabilityDays !== undefined)
        set.defectsLiabilityDays = h.defectsLiabilityDays;
      if (h.scopeInclusionsAr !== undefined)
        set.scopeInclusionsAr = normalizeText(h.scopeInclusionsAr);
      if (h.scopeInclusionsEn !== undefined)
        set.scopeInclusionsEn = normalizeText(h.scopeInclusionsEn);
      if (h.scopeExclusionsAr !== undefined)
        set.scopeExclusionsAr = normalizeText(h.scopeExclusionsAr);
      if (h.scopeExclusionsEn !== undefined)
        set.scopeExclusionsEn = normalizeText(h.scopeExclusionsEn);
      if (h.termsAr !== undefined) set.termsAr = normalizeText(h.termsAr);
      if (h.termsEn !== undefined) set.termsEn = normalizeText(h.termsEn);

      await tx
        .update(contracts)
        .set(set)
        .where(and(eq(contracts.id, id), eq(contracts.status, 'draft')));

      await audit({
        entity: 'contract',
        entityId: id,
        action: 'update',
        before: null,
        after: { header: true },
      });
    },
  );
}
