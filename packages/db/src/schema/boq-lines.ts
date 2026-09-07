import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { boqSections } from './boq-sections';
import { boqs } from './boqs';
import { costItems } from './cost-items';
import { costItemUnit } from './enums';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * One priced item of work. Shaped like `contract_lines` — which is what it
 * becomes when the BOQ generates an execution contract — plus the two columns a
 * contract line has no use for.
 *
 * `itemCode` is the studio's own reference ("2.03", "2.03.1"). Construction BOQs
 * number their items and quantity surveyors call them out by that number on site,
 * so it is free text in whatever convention the firm already uses — Metra never
 * parses it.
 *
 * `provisional` marks a quantity that is an ESTIMATE rather than a count:
 * demolition, anything behind a wall. It decides whether a variance found on site
 * is routine or contentious. A FIRM line measuring 12 doors against 8 means the
 * scope changed and needs a change order; a PROVISIONAL line measuring 240 m2
 * against 200 is just the measurement, billed at the agreed rate. Same
 * arithmetic, completely different conversation — which is why the flag exists
 * before remeasurement does, and why it defaults to false: in fit-out most
 * quantities are known, and marking the few that are not should be deliberate.
 *
 * `costItemId` is a nullable price-book snapshot. A line WITHOUT one carries a
 * price but no cost basis, so it can be tracked for quantity and progress but is
 * blind on margin — which is what the template's price-book code column exists to
 * avoid. cost/margin caches are SERVER-written and never reach a client surface.
 */
export const boqLines = pgTable(
  'boq_lines',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    // Denormalized parent (drives org queries and the draft-only guard).
    boqId: uuid('boq_id').notNull(),
    sectionId: uuid('section_id').notNull(),
    costItemId: uuid('cost_item_id'),
    itemCode: text('item_code'),
    ...bilingual('description'),
    qty: money('qty').notNull(),
    unit: costItemUnit('unit').notNull(),
    unitCost: money('unit_cost').notNull().default('0'),
    unitPrice: money('unit_price').notNull(),
    discountPct: money('discount_pct').notNull().default('0'),
    lineCost: money('line_cost').notNull().default('0'),
    lineTotal: money('line_total').notNull().default('0'),
    lineMargin: money('line_margin').notNull().default('0'),
    provisional: boolean('provisional').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('boq_lines_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('boq_lines', 'description'),
    check(
      'boq_lines_discount_pct_range',
      sql`discount_pct >= 0 and discount_pct <= 100`,
    ),
    // A negative quantity is a de-scope in a variation order, never a BOQ line.
    check('boq_lines_qty_non_negative', sql`qty >= 0`),
    ...sameOrgFk(t, 'boq', boqs, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'section', boqSections, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'costItem', costItems, { onDelete: 'set null' }),
    index('boq_lines_org_section_sort_idx').on(t.orgId, t.sectionId, t.sortOrder),
    index('boq_lines_org_boq_idx').on(t.orgId, t.boqId),
  ],
);

export type BoqLine = typeof boqLines.$inferSelect;
export type NewBoqLine = typeof boqLines.$inferInsert;
