import { uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers';
import { organizations } from './organizations';

/**
 * Org-scoped mixin for every business table: uuid pk, org_id FK to
 * organizations, created_at/updated_at. Spread into a table's column map, then
 * add the table-level `unique (org_id, id)` (enables composite same-org FKs).
 */
export function orgScoped() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, {
        onDelete: 'restrict',
      }),
    ...timestamps(),
  };
}
