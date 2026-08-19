import {
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { variationOrders } from './variation-orders';

/**
 * Append-only variation-order lifecycle log (grant model: INSERT + SELECT only,
 * no UPDATE/DELETE). Records internal_approved/issued and — for a public client
 * decision — the approve/reject with actor name, IP and user agent.
 */
export const variationOrderEvents = pgTable(
  'variation_order_events',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    variationOrderId: uuid('variation_order_id').notNull(),
    kind: text('kind').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorName: text('actor_name'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('variation_order_events_org_id_id_unique').on(t.orgId, t.id),
    ...sameOrgFk(t, 'variationOrder', variationOrders, { onDelete: 'cascade' }),
  ],
);

export type VariationOrderEvent = typeof variationOrderEvents.$inferSelect;
export type NewVariationOrderEvent = typeof variationOrderEvents.$inferInsert;
