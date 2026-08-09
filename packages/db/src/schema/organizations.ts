import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, timestamps } from './_helpers';

/**
 * The tenant root. Its `id` IS the org id every other table scopes to, so this
 * table has no `org_id` column; its RLS policy keys on `id` instead.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...bilingual('name'),
    defaultLocale: text('default_locale').notNull().default('ar-EG'),
    ...timestamps(),
  },
  () => [bilingualCheck('organizations', 'name')],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
