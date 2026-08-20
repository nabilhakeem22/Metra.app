import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { clientType } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';

/**
 * Clients (P1 Slice 2 + Slice 4 profile). Bilingual name + a `type`, a tax
 * registration number, and advance/retention percentages. The flat `contact_name/email/
 * phone` columns are KEPT (proposal send reads `clients.email`); richer contacts
 * live in `client_contacts`. Soft-deleted via `active`. `unique(org_id, id)` is
 * the universal composite-FK target so projects reference a client in-org.
 */
export const clients = pgTable(
  'clients',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    ...bilingual('name'),
    type: clientType('type').notNull().default('company'),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    address: text('address'),
    taxRegistrationNumber: text('tax_registration_number'),
    advancePct: money('advance_pct').notNull().default('0'),
    retentionPct: money('retention_pct').notNull().default('0'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('clients_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('clients', 'name'),
    check('clients_advance_pct_range', sql`advance_pct >= 0 and advance_pct <= 100`),
    check(
      'clients_retention_pct_range',
      sql`retention_pct >= 0 and retention_pct <= 100`,
    ),
    index('clients_org_active_idx').on(t.orgId, t.active),
  ],
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
