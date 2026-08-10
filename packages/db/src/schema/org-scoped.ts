import { uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers';

/**
 * Org-scoped mixin for every business table: uuid pk, org_id, created_at/updated_at.
 *
 * NOTE: this module is intentionally a LEAF (it does NOT import `organizations`).
 * The org_id -> organizations FK is attached per-table via the deferred
 * `.references((): AnyPgColumn => organizations.id)` form. Keeping `orgScoped`
 * dependency-free means it is always fully evaluated before any table calls it,
 * which avoids the organizations<->files<->org-scoped import cycle blowing up
 * under vitest's module runner (native ESM / next build hoist it, vitest does not).
 * FK name/onDelete are unchanged, so no migration changes.
 */
export function orgScoped() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    ...timestamps(),
  };
}
