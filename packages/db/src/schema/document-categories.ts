import {
  boolean,
  index,
  integer,
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
 * Per-firm document categories — the filing vocabulary a studio uses for the files
 * it attaches to a client or a project. FIRM-CONFIGURABLE by owner decision: each
 * org gets a sensible default set (see ./document-category-defaults) and can rename,
 * reorder, deactivate or extend it from Settings.
 *
 * `key` marks a row that came from the default seed, so a default can be recognised
 * later; a firm's own category has a null key. It is NOT an identifier the app
 * branches on — nothing about a document's handling depends on which category it is
 * in, which is what keeps the vocabulary genuinely the firm's own.
 *
 * DEACTIVATE, DON'T DELETE: `active` hides a category from the picker while leaving
 * every already-filed document where it is. The grants allow no DELETE, so a
 * category that files exist under can never vanish out from under them.
 */
export const documentCategories = pgTable(
  'document_categories',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    ...bilingual('name'),
    /** Set on a seeded default, null on a firm's own category. */
    key: text('key'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    unique('document_categories_org_id_id_unique').on(t.orgId, t.id),
    // A seeded key appears at most once per org, so a re-run of the backfill (or a
    // bootstrap that fires twice) cannot duplicate the starting set.
    unique('document_categories_org_key_unique').on(t.orgId, t.key),
    bilingualCheck('document_categories', 'name'),
    index('document_categories_org_active_idx').on(t.orgId, t.active, t.sortOrder),
  ],
);

export type DocumentCategory = typeof documentCategories.$inferSelect;
export type NewDocumentCategory = typeof documentCategories.$inferInsert;
