import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { contracts } from './contracts';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Append-only contract lifecycle log (grant model: INSERT + SELECT only, no
 * UPDATE/DELETE). Records issue/terminate and — for a public client electronic
 * acknowledgement — the actor name, IP, user agent and the hash of the
 * acknowledged document. Binding ITIDA e-signature stays deferred (A5).
 */
export const contractEvents = pgTable(
  'contract_events',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    // sha256 of the acknowledged document payload (electronic acknowledgement).
    pdfHash: text('pdf_hash'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('contract_events_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'cascade' }),
  ],
);

export type ContractEvent = typeof contractEvents.$inferSelect;
export type NewContractEvent = typeof contractEvents.$inferInsert;
