import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { clients } from './clients';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Rich contacts for a client (P1 Slice 4). Cascades from its client. At most one
 * `is_primary` per client, enforced by a partial unique index. WhatsApp is a
 * stored number only (no messaging). RLS: org-isolated + FORCE.
 */
export const clientContacts = pgTable(
  'client_contacts',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id').notNull(),
    name: text('name').notNull(),
    role: text('role'),
    phone: text('phone'),
    email: text('email'),
    whatsapp: text('whatsapp'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    unique('client_contacts_org_id_id_unique').on(t.orgId, t.id),
    // At most one primary contact per client.
    uniqueIndex('client_contacts_one_primary')
      .on(t.orgId, t.clientId)
      .where(sql`${t.isPrimary}`),
    ...sameOrgFk(t, 'client', clients, { onDelete: 'cascade' }),
    index('client_contacts_org_client_idx').on(t.orgId, t.clientId),
  ],
);

export type ClientContact = typeof clientContacts.$inferSelect;
export type NewClientContact = typeof clientContacts.$inferInsert;
