// The rules a contact's typed values must keep. Pure and client-safe: the sheet
// runs them before sending, and the core runs them again on what arrived.
import { hasFieldErrors, type FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { clean } from '@/lib/validation/text';
import { maxCharacters, requiredText } from '@/lib/validation/text-field-rules';
import type { ContactField, ContactInput } from './fields';

/** Boundary length caps, equal to the client's own (a client's first contact is
 *  copied from the client form, so it can never fail here). */
const CONTACT_LIMITS = { name: 200, role: 120, phone: 40, email: 254, whatsapp: 40 } as const;

/** The free text as the database stores it: trimmed, and blank as null. */
export function normalizedContact(input: ContactInput) {
  return {
    name: clean(input.name),
    role: clean(input.role),
    phone: clean(input.phone),
    email: clean(input.email),
    whatsapp: clean(input.whatsapp),
  };
}

export type ContactRead =
  | { ok: true; values: ReturnType<typeof normalizedContact> & { name: string } }
  | { ok: false; errors: FieldErrors<ContactField> };

/** Read every typed value, or say under each field what is wrong: a name is
 *  required, and every box has a cap. */
export function readContactInput(input: ContactInput): ContactRead {
  const v = normalizedContact(input);
  const errors = collectFieldErrors<ContactField>({
    name: requiredText(v.name) ?? maxCharacters(v.name, CONTACT_LIMITS.name),
    role: maxCharacters(v.role, CONTACT_LIMITS.role),
    phone: maxCharacters(v.phone, CONTACT_LIMITS.phone),
    email: maxCharacters(v.email, CONTACT_LIMITS.email),
    whatsapp: maxCharacters(v.whatsapp, CONTACT_LIMITS.whatsapp),
  });
  const name = v.name;
  if (hasFieldErrors(errors) || name === null) return { ok: false, errors };
  return { ok: true, values: { ...v, name } };
}

/** The sheet's pre-check: the same rules, as the refusals under each field. */
export function contactFieldErrors(input: ContactInput): FieldErrors<ContactField> {
  const read = readContactInput(input);
  return read.ok ? {} : read.errors;
}
