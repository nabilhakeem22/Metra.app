// The client sheet's state as plain functions (no React, no 'use client'): what
// a new client starts with, what an edit loads, and what Save sends.
import type { ClientField } from '@/lib/clients/fields';
import type { ClientRow } from './types';

export interface ClientFormState {
  nameEn: string;
  nameAr: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  taxRegistrationNumber: string;
  notes: string;
}

export const EMPTY_CLIENT_FORM: ClientFormState = {
  nameEn: '',
  nameAr: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  address: '',
  taxRegistrationNumber: '',
  notes: '',
};

/** The fields under "More details": an error on one of them unfolds it (D6). */
export const FOLDED_CLIENT_FIELDS: readonly ClientField[] = ['taxRegistrationNumber', 'address', 'notes'];

/** An existing client, as the sheet edits it. Absent columns become empty boxes. */
export function clientFormOf(item: ClientRow): ClientFormState {
  return {
    nameEn: item.nameEn ?? '',
    nameAr: item.nameAr ?? '',
    contactName: item.contactName ?? '',
    email: item.email ?? '',
    phone: item.phone ?? '',
    city: item.city ?? '',
    country: item.country ?? '',
    address: item.address ?? '',
    taxRegistrationNumber: item.taxRegistrationNumber ?? '',
    notes: item.notes ?? '',
  };
}

/** What Save sends: an emptied box is absent (null), not the empty string. */
export function clientPayload(form: ClientFormState) {
  return {
    nameEn: form.nameEn || null,
    nameAr: form.nameAr || null,
    contactName: form.contactName || null,
    email: form.email || null,
    phone: form.phone || null,
    city: form.city || null,
    country: form.country || null,
    address: form.address || null,
    taxRegistrationNumber: form.taxRegistrationNumber || null,
    notes: form.notes || null,
  };
}
