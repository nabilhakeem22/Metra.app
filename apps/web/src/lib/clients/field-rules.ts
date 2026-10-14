// The rules a client's typed values must keep. Pure and client-safe: the sheet
// runs them before sending, and the core runs them again on what arrived. Every
// broken rule is reported at once, under its own field.
import { hasFieldErrors, type FieldErrors } from '@/lib/actions/field-errors';
import { collectFieldErrors } from '@/lib/validation/field-rules';
import { PERCENT_REFUSAL } from '@/lib/validation/number-field-rules';
import { normalizePercent } from '@/lib/validation/percent';
import { clean } from '@/lib/validation/text';
import { bilingualNameErrors, maxCharacters, type BilingualNameField } from '@/lib/validation/text-field-rules';
import type { ClientField, ClientInput } from './fields';

/** Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits. */
const CLIENT_NAME_MAX = 200;
const CLIENT_LIMITS = {
  contactName: 200,
  email: 254,
  phone: 40,
  city: 120,
  country: 120,
  address: 300,
  taxRegistrationNumber: 64,
  notes: 2000,
} as const;

/** The free text as the database stores it: trimmed, and blank as null. */
export function normalizedClient(input: ClientInput) {
  return {
    nameEn: clean(input.nameEn),
    nameAr: clean(input.nameAr),
    type: input.type ?? undefined,
    contactName: clean(input.contactName),
    email: clean(input.email),
    phone: clean(input.phone),
    city: clean(input.city),
    country: clean(input.country),
    address: clean(input.address),
    taxRegistrationNumber: clean(input.taxRegistrationNumber),
    notes: clean(input.notes),
  };
}

/** The typed values as the database stores them; a percentage left `undefined`
 *  was not sent, so an edit leaves the stored one as it was. */
export type ClientValues = ReturnType<typeof normalizedClient> & {
  advancePct: string | undefined;
  retentionPct: string | undefined;
};

export type ClientRead =
  | { ok: true; values: ClientValues }
  | { ok: false; errors: FieldErrors<ClientField> };

/** A sent percentage in [0, 100], `undefined` when not sent, null when unreadable. */
function sentPercent(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : normalizePercent(value);
}

/**
 * Read every typed value at once, or say what is wrong with each of them.
 * `phoneRequired`: always on create; on an edit only when the stored client has
 * a phone (a phone that exists may not be blanked, a legacy record without one
 * stays editable).
 */
export function readClientInput(input: ClientInput, rules: { phoneRequired: boolean }): ClientRead {
  const v = normalizedClient(input);
  const advancePct = sentPercent(input.advancePct);
  const retentionPct = sentPercent(input.retentionPct);
  const errors: FieldErrors<ClientField> = {
    ...bilingualNameErrors(v.nameEn, v.nameAr, CLIENT_NAME_MAX),
    ...collectFieldErrors<Exclude<ClientField, BilingualNameField>>({
      phone: rules.phoneRequired && !v.phone ? { code: 'phone_required' } : maxCharacters(v.phone, CLIENT_LIMITS.phone),
      contactName: maxCharacters(v.contactName, CLIENT_LIMITS.contactName),
      email: maxCharacters(v.email, CLIENT_LIMITS.email),
      city: maxCharacters(v.city, CLIENT_LIMITS.city),
      country: maxCharacters(v.country, CLIENT_LIMITS.country),
      address: maxCharacters(v.address, CLIENT_LIMITS.address),
      taxRegistrationNumber: maxCharacters(v.taxRegistrationNumber, CLIENT_LIMITS.taxRegistrationNumber),
      notes: maxCharacters(v.notes, CLIENT_LIMITS.notes),
      advancePct: advancePct === null ? PERCENT_REFUSAL : null,
      retentionPct: retentionPct === null ? PERCENT_REFUSAL : null,
    }),
  };
  if (hasFieldErrors(errors) || advancePct === null || retentionPct === null) return { ok: false, errors };
  return { ok: true, values: { ...v, advancePct, retentionPct } };
}

/** The sheet's pre-check: the same rules, as the refusals under each field. */
export function clientFieldErrors(input: ClientInput, rules: { phoneRequired: boolean }): FieldErrors<ClientField> {
  const read = readClientInput(input, rules);
  return read.ok ? {} : read.errors;
}
