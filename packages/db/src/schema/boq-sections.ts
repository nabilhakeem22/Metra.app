import {
  index,
  integer,
  pgTable,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, money } from './_helpers';
import { boqs } from './boqs';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * A titled section of a BOQ — "Gypsum works", "Painting". Mirrors
 * `contract_sections`, which is what a BOQ section becomes when the BOQ is
 * turned into an execution contract. Carries a server-written subtotal.
 */
export const boqSections = pgTable(
  'boq_sections',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    boqId: uuid('boq_id').notNull(),
    ...bilingual('title'),
    sortOrder: integer('sort_order').notNull().default(0),
    sectionSubtotal: money('section_subtotal').notNull().default('0'),
  },
  (t) => [
    unique('boq_sections_org_id_id_unique').on(t.orgId, t.id),
    bilingualCheck('boq_sections', 'title'),
    ...sameOrgFk(t, 'boq', boqs, { onDelete: 'cascade' }),
    index('boq_sections_org_boq_sort_idx').on(t.orgId, t.boqId, t.sortOrder),
  ],
);

export type BoqSection = typeof boqSections.$inferSelect;
export type NewBoqSection = typeof boqSections.$inferInsert;
