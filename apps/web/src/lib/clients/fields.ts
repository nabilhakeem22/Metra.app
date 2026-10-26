// The client's input and the paths a refusal can name. A plain module (types and
// tuples), so the client form, the pure rules and the server core share it.
import type { ClientType } from '@metra/db';

/** Every path a client refusal can name; `name` is the Arabic/English pair. */
const CLIENT_FIELDS = [
  'name',
  'nameEn',
  'nameAr',
  'contactName',
  'email',
  'phone',
  'city',
  'country',
  'address',
  'taxRegistrationNumber',
  'notes',
  'advancePct',
  'retentionPct',
] as const;

export type ClientField = (typeof CLIENT_FIELDS)[number];

/** The fields the new/edit client sheet renders (the percentages live on Financials). */
export const CLIENT_FORM_FIELDS = CLIENT_FIELDS.filter(
  (field): field is Exclude<ClientField, 'advancePct' | 'retentionPct'> =>
    field !== 'advancePct' && field !== 'retentionPct',
);

export interface ClientInput {
  nameEn?: string | null;
  nameAr?: string | null;
  type?: ClientType | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  taxRegistrationNumber?: string | null;
  advancePct?: string | null;
  retentionPct?: string | null;
  notes?: string | null;
}
