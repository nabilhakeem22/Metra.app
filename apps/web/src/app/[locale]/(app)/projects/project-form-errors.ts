// Which field of the project form a server refusal belongs under. PURE (no
// React, no 'use client'), so it is tested without a sheet.
import type { ActionCode } from '@/lib/actions/result';

/** Where a refusal is shown: under its field, or above the footer. */
export type ProjectFormField = 'name' | 'code' | 'client' | 'startDate' | 'endDate' | 'form';

const FIELD_OF: Partial<Record<ActionCode, ProjectFormField>> = {
  name_required: 'name',
  code_required: 'code',
  client_required: 'client',
  start_date_required: 'startDate',
  // An end date before the start: the end date is the one to change.
  invalid_dates: 'endDate',
};

export function projectFieldFor(code: ActionCode): ProjectFormField {
  return FIELD_OF[code] ?? 'form';
}
