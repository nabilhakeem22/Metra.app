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
    /**
     * WHICH CHANNEL decided this event — 'staff' or 'client' (0051, CHECKed
     * there).
     *
     * NULLABLE with NO DEFAULT, deliberately unlike `engagement_events`, whose
     * `not null default 'staff'` is only safe because it was there from row one.
     * NULL means "we did not record which channel decided this", which is the
     * truth for every row written before 0051; the read ladder in
     * `lib/variations/decided-message.ts` falls back to the old ordering for
     * NULL, so no historical page changes its wording. There is no backfill —
     * every discriminator one could use is nullable on BOTH paths, so it would
     * be a guess on an evidentiary record.
     */
    actorChannel: text('actor_channel'),
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
