import {
  boolean,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck } from './_helpers';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Clients (P1 Slice 2). Bilingual name + one inline contact. Soft-deleted via
 * `active` (no hard DELETE in the UI). `unique(org_id, id)` is the universal
 * composite-FK target so projects reference a client within the same org.
 */
export const clients = pgTable(
  'clients',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    ...bilingual('name'),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    address: text('address'),
    taxRegistrationNumber: text('tax_registration_number'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('clients_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('clients', 'name'),
    index('clients_org_active_idx').on(t.orgId, t.active),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
