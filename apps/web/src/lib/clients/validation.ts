// The client form's boundary rules: normalisation, length caps and the type
// check, shared by create and update (moved verbatim out of ./core).
import { CLIENT_TYPES, type ClientType } from '@metra/db';
import { clean } from '@/lib/validation/text';
import type { ClientInput } from './core';

// Boundary length caps (defense-in-depth), mirroring org/core profileWithinLimits.
const LIMITS = {
  name: 200,
  contactName: 200,
  email: 254,
  phone: 40,
  city: 120,
  country: 120,
  address: 300,
  taxReg: 64,
  notes: 2000,
} as const;

export type NormalizedClient = ReturnType<typeof normalized>;

export function normalized(input: ClientInput) {
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

export function withinLimits(v: NormalizedClient): boolean {
  const ok = (s: string | null, max: number) => (s?.length ?? 0) <= max;
  return (
    ok(v.nameEn, LIMITS.name) &&
    ok(v.nameAr, LIMITS.name) &&
    ok(v.contactName, LIMITS.contactName) &&
    ok(v.email, LIMITS.email) &&
    ok(v.phone, LIMITS.phone) &&
    ok(v.city, LIMITS.city) &&
    ok(v.country, LIMITS.country) &&
    ok(v.address, LIMITS.address) &&
    ok(v.taxRegistrationNumber, LIMITS.taxReg) &&
    ok(v.notes, LIMITS.notes)
  );
}

export function validType(t: ClientType | undefined): boolean {
  return t === undefined || CLIENT_TYPES.includes(t);
}
