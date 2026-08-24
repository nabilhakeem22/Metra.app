import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { bilingual, bilingualCheck, timestamps } from './_helpers';

/**
 * Account — the billing / ownership entity that sits ABOVE tenancy. An
 * organization belongs to exactly one account (`organizations.account_id`), and
 * in A1 the mapping is 1:1. Accounts carry NO `org_id`: they are not org-scoped,
 * so they are deliberately excluded from `orgScopedTables` and the per-org
 * isolation gate. Their RLS is bespoke (an account is visible only to a member of
 * an org that owns it) and rows are created EXCLUSIVELY via the SECURITY DEFINER
 * `app_bootstrap_account()` — see rls/functions.sql. Add `plan_key` in A2, not
 * here.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ...bilingual('name'),
    ...timestamps(),
  },
  () => [bilingualCheck('accounts', 'name')],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
