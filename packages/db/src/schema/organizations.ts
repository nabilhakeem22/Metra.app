import { isNotNull } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
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
    // The owning account (above tenancy). NULLABLE in A1 while the 1:1 backfill
    // links every existing org; A2+ tightens/uses it. on delete restrict: an
    // account can't be dropped while an org still points at it.
    accountId: uuid('account_id').references(
      (): AnyPgColumn => accounts.id,
      { onDelete: 'restrict' },
    ),
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
  (t) => [
    bilingualCheck('organizations', 'name'),
    // UNIQUE partial index — DB-enforces the 1:1 org<->account invariant (no two
    // orgs may share an account). Partial (WHERE account_id IS NOT NULL) so the
    // A1 additive window, where account_id is still nullable, isn't constrained on
    // the NULLs. Name kept stable to match 0029_accounts.sql.
    uniqueIndex('organizations_account_id_idx')
      .on(t.accountId)
      .where(isNotNull(t.accountId)),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
