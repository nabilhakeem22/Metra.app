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
import { clientPageChecks } from './organizations-checks';

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
    // What the client page shows about the studio (0058). All optional, edited
    // by owner/admin in Settings, checked by ./organizations-checks (0059). The
    // payment details reach the client only while a payment is due (the portal
    // mapper's rule, not the database's).
    studioPhone: text('studio_phone'),
    studioWhatsapp: text('studio_whatsapp'),
    instapayAddress: text('instapay_address'),
    bankName: text('bank_name'),
    bankAccountHolder: text('bank_account_holder'),
    bankAccountNumber: text('bank_account_number'),
    bankIban: text('bank_iban'),
    ...timestamps(),
  },
  (t) => [
    bilingualCheck('organizations', 'name'),
    ...clientPageChecks(),
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
