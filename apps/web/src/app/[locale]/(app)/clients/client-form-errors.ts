// Which field of the client form a server refusal belongs under. PURE (no
// React, no 'use client'), so it is tested without a sheet.
import type { ActionCode } from '@/lib/actions/result';

/** Where a refusal is shown: under the names, under the phone, or above the footer. */
export type ClientFormField = 'name' | 'phone' | 'form';

const FIELD_OF: Partial<Record<ActionCode, ClientFormField>> = {
  name_required: 'name',
  phone_required: 'phone',
};

export function clientFieldFor(code: ActionCode): ClientFormField {
  return FIELD_OF[code] ?? 'form';
}
