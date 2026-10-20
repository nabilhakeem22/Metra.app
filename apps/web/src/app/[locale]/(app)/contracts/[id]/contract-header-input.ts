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
export type HeaderField = keyof HeaderForm;

/**
 * Not on an execution contract: its schedule says how it is paid (plan A5), and
 * the day it was signed is its signing event's, online or on paper, never a
 * typed date that could say another day (A3 F4).
 */
const PROPOSAL_CONTRACT_ONLY: readonly HeaderField[] = ['advancePct', 'retentionPct', 'signatureDate'];

/** The boxes the form shows for this contract. */
export function contractHeaderFieldsFor(detail: Pick<ContractHeaderDetail, 'sourceBoqId'>): readonly HeaderField[] {
  return detail.sourceBoqId === null
    ? CONTRACT_HEADER_FIELDS
    : CONTRACT_HEADER_FIELDS.filter((field) => !PROPOSAL_CONTRACT_ONLY.includes(field));
}

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

/**
 * What the save carries: an empty box is null, a typed number a number. An
 * execution contract sends no advance, retention or signature date: not
 * sending them leaves them as they are (0, 0 and none).
 */
export function contractHeaderInput(form: HeaderForm, shown: readonly HeaderField[]) {
  const sent = (field: 'advancePct' | 'retentionPct') => (shown.includes(field) ? form[field] : undefined);
  return {
    signatureDate: shown.includes('signatureDate') ? form.signatureDate || null : undefined,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    advancePct: sent('advancePct'),
    retentionPct: sent('retentionPct'),
    paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : null,
    defectsLiabilityDays: form.defectsLiabilityDays ? Number(form.defectsLiabilityDays) : null,
    termsEn: form.termsEn || null,
    termsAr: form.termsAr || null,
  };
}
