// The contract header form's typed state, and its two conversions: from the
// stored contract, and to the save input. Plain functions, testable alone.
import type { ContractHeaderDetail } from '@/lib/contracts/queries';

/** Every box of the header form; a refusal the server names sits under its box. */
export const CONTRACT_HEADER_FIELDS = [
  'advancePct',
  'retentionPct',
  'signatureDate',
  'startDate',
  'endDate',
  'paymentTermsDays',
  'defectsLiabilityDays',
  'termsEn',
  'termsAr',
] as const;

export type HeaderForm = Record<(typeof CONTRACT_HEADER_FIELDS)[number], string>;

export function headerFormOf(detail: ContractHeaderDetail): HeaderForm {
  return {
    signatureDate: detail.signatureDate ?? '',
    startDate: detail.startDate ?? '',
    endDate: detail.endDate ?? '',
    advancePct: detail.advancePct,
    retentionPct: detail.retentionPct,
    paymentTermsDays: detail.paymentTermsDays != null ? String(detail.paymentTermsDays) : '',
    defectsLiabilityDays:
      detail.defectsLiabilityDays != null ? String(detail.defectsLiabilityDays) : '',
    termsEn: detail.termsEn ?? '',
    termsAr: detail.termsAr ?? '',
  };
}

/** What the save carries: an empty box is null, a typed number a number. */
export function contractHeaderInput(form: HeaderForm) {
  return {
    signatureDate: form.signatureDate || null,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    advancePct: form.advancePct,
    retentionPct: form.retentionPct,
    paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : null,
    defectsLiabilityDays: form.defectsLiabilityDays ? Number(form.defectsLiabilityDays) : null,
    termsEn: form.termsEn || null,
    termsAr: form.termsAr || null,
  };
}
