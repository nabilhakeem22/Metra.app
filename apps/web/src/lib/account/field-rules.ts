// The rule the account's display name keeps. Pure and client-safe: the
// Account page runs it before sending, the action again on what arrived.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { maxCharacters } from '@/lib/validation/text-field-rules';

export const ACCOUNT_FIELDS = ['fullName'] as const;

export type AccountField = (typeof ACCOUNT_FIELDS)[number];

const FULL_NAME_MAX = 200;

/** The display name may be blank (it is optional) but not longer than the cap. */
export function accountFieldErrors(input: { fullName?: string }): FieldErrors<AccountField> {
  return collectFieldErrors<AccountField>({ fullName: maxCharacters(input.fullName, FULL_NAME_MAX) });
}
