import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { contracts } from './contracts';
import { variationStatus } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';
import { projects } from './projects';

/**
 * Variation Orders (أوامر التغيير, P1 Slice 4). A priced change against an
 * issued/signed contract. `number` renders `VO-YYYY-NNNN`. Lines are frozen once
 * the VO leaves `draft` (child-draft guard); `netDelta` (may be NEGATIVE for a
 * de-scope) is server-computed and frozen at internal approval. Immutable once it
 * leaves `draft` except the whitelisted status transitions (A2).
 */
export const variationOrders = pgTable(
  'variation_orders',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    number: integer('number').notNull(),
    contractId: uuid('contract_id').notNull(),
    projectId: uuid('project_id').notNull(),
    status: variationStatus('status').notNull().default('draft'),
    ...bilingual('title'),
    reasonAr: text('reason_ar'),
    reasonEn: text('reason_en'),
    // Server-computed sum of the VO line totals; may be negative.
    netDelta: money('net_delta').notNull().default('0'),
    tokenHash: text('token_hash'),
    shareExpiresAt: timestamp('share_expires_at', { withTimezone: true }),
  },
  (t) => [
    unique('variation_orders_org_id_id_unique').on(t.orgId, t.id),
    unique('variation_orders_org_id_number_unique').on(t.orgId, t.number),
    unique('variation_orders_token_hash_unique').on(t.tokenHash),
    bilingualCheck('variation_orders', 'title'),
    ...sameOrgFk(t, 'contract', contracts, { onDelete: 'restrict' }),
    ...sameOrgFk(t, 'project', projects, { onDelete: 'restrict' }),
    index('variation_orders_org_status_idx').on(t.orgId, t.status),
    index('variation_orders_org_contract_idx').on(t.orgId, t.contractId),
  ],
);

export type VariationOrder = typeof variationOrders.$inferSelect;
export type NewVariationOrder = typeof variationOrders.$inferInsert;
