import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Wrong sign-in codes, counted per identifier (0067, security batch 3, P2): one
 * row per identifier, a fixed one-hour window opened by its first wrong code.
 *
 * NOT org-scoped, deliberately: a row exists BEFORE sign-in, when there is no
 * org and no session. Keyed by a hash of the canonical identifier; no tenant
 * data, no address. Written and read ONLY by the definer functions in
 * rls/functions/90-sign-in.sql; metra_app holds no privilege on it.
 */
export const signInFailures = pgTable(
  'sign_in_failures',
  {
    identifierHash: text('identifier_hash').primaryKey(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    failures: smallint('failures').notNull().default(1),
  },
  (t) => [
    check('sign_in_failures_identifier_hash_shape', sql`identifier_hash ~ '^[0-9a-f]{64}$'`),
    check('sign_in_failures_failures_range', sql`failures between 1 and 100`),
    // The record function removes rows whose window ended, oldest first.
    index('sign_in_failures_window_started_idx').on(t.windowStartedAt),
  ],
);
