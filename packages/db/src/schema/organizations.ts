import { isNotNull, sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
    // What the client page shows about the studio (0058). All optional, edited
    // by owner/admin in Settings. The two numbers are digits with an optional
    // leading +, 7 to 15 of them; the payment details reach the client only
    // while a payment is due (the portal mapper's rule, not the database's).
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
    check(
      'organizations_studio_phone_format',
      sql`studio_phone IS NULL OR studio_phone ~ '^\\+?[0-9]{7,15}$'`,
    ),
    check(
      'organizations_studio_whatsapp_format',
      sql`studio_whatsapp IS NULL OR studio_whatsapp ~ '^\\+?[0-9]{7,15}$'`,
    ),
    check(
      'organizations_instapay_address_length',
      sql`instapay_address IS NULL OR char_length(instapay_address) BETWEEN 3 AND 100`,
    ),
    check(
      'organizations_bank_text_length',
      sql`(bank_name IS NULL OR char_length(bank_name) BETWEEN 2 AND 120) AND (bank_account_holder IS NULL OR char_length(bank_account_holder) BETWEEN 2 AND 120)`,
    ),
    check(
      'organizations_bank_account_number_format',
      sql`bank_account_number IS NULL OR bank_account_number ~ '^[0-9A-Za-z-]{4,34}$'`,
    ),
    check(
      'organizations_bank_iban_format',
      sql`bank_iban IS NULL OR bank_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'`,
    ),
    // An account number or IBAN the client cannot name a bank for is refused.
    check(
      'organizations_bank_account_needs_bank',
      sql`(bank_account_number IS NULL AND bank_iban IS NULL) OR bank_name IS NOT NULL`,
    ),
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
