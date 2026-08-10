import { boolean, pgTable, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, timestamps } from './_helpers';
import { files } from './files';

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
    // Company profile (Slice 1). logo_file_id is a deferred FK to files.id; the
    // thunk avoids the organizations<->files circular import at module load.
    logoFileId: uuid('logo_file_id').references((): AnyPgColumn => files.id),
    city: text('city'),
    taxRegistrationNumber: text('tax_registration_number'),
    // Org settings (defaults; UI wiring is later slices).
    hideMarginFromPm: boolean('hide_margin_from_pm').notNull().default(false),
    restrictFirmDashboard: boolean('restrict_firm_dashboard')
      .notNull()
      .default(false),
    ...timestamps(),
  },
  () => [bilingualCheck('organizations', 'name')],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
