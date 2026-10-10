// The "What your clients see" card's fields, in the order the client page uses
// them. A plain module (no React, no 'use client'), so the card and its sheet
// read one list.
import type { ClientPageField } from '@/lib/org/client-page-details';

export interface ClientPageFieldSpec {
  field: ClientPageField;
  group: 'contact' | 'payment';
  /** A number or an address the client copies: always laid out left to right. */
  ltr: boolean;
  inputMode?: 'tel' | 'text';
  autoComplete?: string;
}

export const CLIENT_PAGE_FIELD_SPECS: readonly ClientPageFieldSpec[] = [
  { field: 'studioPhone', group: 'contact', ltr: true, inputMode: 'tel', autoComplete: 'tel' },
  { field: 'studioWhatsapp', group: 'contact', ltr: true, inputMode: 'tel', autoComplete: 'tel' },
  { field: 'instapayAddress', group: 'payment', ltr: true },
  { field: 'bankName', group: 'payment', ltr: false },
  { field: 'bankAccountHolder', group: 'payment', ltr: false },
  { field: 'bankAccountNumber', group: 'payment', ltr: true },
  { field: 'bankIban', group: 'payment', ltr: true },
];

/** The card's values as text boxes hold them: '' for nothing. */
export type ClientPageDraft = Record<ClientPageField, string>;

/** The stored values as the card's boxes hold them (null becomes ''). */
export function clientPageDraftOf(
  stored: Partial<Record<ClientPageField, string | null>> | undefined,
): ClientPageDraft {
  return Object.fromEntries(
    CLIENT_PAGE_FIELD_SPECS.map(({ field }) => [field, stored?.[field] ?? '']),
  ) as ClientPageDraft;
}

/**
 * What a save sends: only the boxes the member changed since the sheet opened,
 * a box emptied as null (an explicit clear). A box left alone is not sent, so it
 * can never overwrite a colleague's newer value.
 */
export function changedDraftFields(initial: ClientPageDraft, draft: ClientPageDraft): Partial<Record<ClientPageField, string | null>> {
  return Object.fromEntries(
    CLIENT_PAGE_FIELD_SPECS.filter(({ field }) => draft[field] !== initial[field]).map(({ field }) => [
      field,
      draft[field].trim() === '' ? null : draft[field],
    ]),
  );
}
