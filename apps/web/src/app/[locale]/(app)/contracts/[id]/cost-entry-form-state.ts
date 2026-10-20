// The cost entry form's typed state and its two conversions: from a listed
// entry, and to the action input. Plain functions, so they are tested without
// a sheet. A blank box is '' here and null in the payload.
import type { CostCategory } from '@metra/db';
import type { CostEntryField, TypedCostEntry } from '@/lib/execution/costs/input';
import type { CostEntryRow } from '@/lib/execution/costs/types';

/** The control each refusal sits under. */
export const COST_ENTRY_CONTROL_ID: Record<CostEntryField, string> = {
  category: 'ce-category',
  description: 'ce-description',
  amount: 'ce-amount',
  incurredOn: 'ce-date',
  contractSectionId: 'ce-section',
  contractLineId: 'ce-line',
  qty: 'ce-qty',
  unit: 'ce-unit',
  unitCost: 'ce-unit-cost',
  supplier: 'ce-supplier',
  reference: 'ce-reference',
  costItemId: 'ce-item',
};

export interface CostEntryFormState {
  category: CostCategory;
  description: string;
  amount: string;
  incurredOn: string;
  contractSectionId: string;
  contractLineId: string;
  /** What the picked line reads as, kept so the picker can show it whatever is searched next. */
  lineLabel: string;
  qty: string;
  unit: string;
  unitCost: string;
  supplier: string;
  reference: string;
  costItemId: string;
  costItemLabel: string;
}

export function emptyCostEntryForm(today: string): CostEntryFormState {
  return {
    category: 'materials',
    description: '',
    amount: '',
    incurredOn: today,
    contractSectionId: '',
    contractLineId: '',
    lineLabel: '',
    qty: '',
    unit: '',
    unitCost: '',
    supplier: '',
    reference: '',
    costItemId: '',
    costItemLabel: '',
  };
}

/** A listed entry as the form edits it; `labels` names its line and price book item in the page's language. */
export function costEntryFormOf(entry: CostEntryRow, labels: { line: string; costItem: string }): CostEntryFormState {
  return {
    category: entry.category,
    description: entry.description,
    amount: entry.amount,
    incurredOn: entry.incurredOn,
    contractSectionId: entry.contractSectionId ?? '',
    contractLineId: entry.contractLineId ?? '',
    lineLabel: labels.line,
    qty: entry.qty ?? '',
    unit: entry.unit ?? '',
    unitCost: entry.unitCost ?? '',
    supplier: entry.supplier ?? '',
    reference: entry.reference ?? '',
    costItemId: entry.costItemId ?? '',
    costItemLabel: labels.costItem,
  };
}

const orNull = (value: string) => (value.trim() === '' ? null : value);

export function costEntryPayload(form: CostEntryFormState): TypedCostEntry {
  return {
    category: form.category,
    description: form.description,
    amount: form.amount,
    incurredOn: form.incurredOn,
    contractSectionId: orNull(form.contractSectionId),
    contractLineId: orNull(form.contractLineId),
    qty: orNull(form.qty),
    unit: orNull(form.unit),
    unitCost: orNull(form.unitCost),
    supplier: orNull(form.supplier),
    reference: orNull(form.reference),
    costItemId: orNull(form.costItemId),
  };
}
