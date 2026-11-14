-- 0067: security batch 3 (P2, A4). SCHEMA ONLY and ADDITIVE: one new table and
-- one setting on an existing function. No row is updated, nothing is
-- backfilled, no policy, no grant, no trigger and no apply-rls function is
-- referenced (the table's policy, its revoke and the two functions that read
-- and write it live in rls/policies/00-core.sql, rls/roles.sql and
-- rls/functions/90-sign-in.sql, applied by `db:apply-rls` AFTER this file).
--
-- WHAT IT ADDS.
--   * sign_in_failures: the wrong sign-in codes typed for one identifier, one
--     row per identifier, in a fixed one-hour window opened by its first wrong
--     code (P2). The key is sha256 of the canonical identifier, made by the
--     app: the table holds no address, no user id and no org. NOT org-scoped: a
--     row exists before sign-in, when there is no org and no session.
--     - sign_in_failures_identifier_hash_shape: 64 lower-case hex characters;
--     - sign_in_failures_failures_range: 1 to 100 (the record function stops
--       counting at 100);
--     - sign_in_failures_window_started_idx: the record function removes rows
--       whose window ended, oldest first.
--   * RLS IS ENABLED AND FORCED on the new table HERE (the 0064 rule): with no
--     policy yet, no role but its owner reads or writes it, so an apply-rls that
--     stops half way leaves it closed, never open.
--   * text_has_visible_character(text) gets a pinned, empty search_path (A4, a
--     Supabase advisor finding). Its body already calls OPERATOR(pg_catalog.~),
--     and `text` and `boolean` resolve from pg_catalog, which is always
--     searched, so it answers the same; it stays IMMUTABLE. A SET clause only
--     stops the planner inlining it, which the two CHECKs that call it
--     (site_material_receipts, site_notes) do not need.
--
-- NO LOCK BLOCK, unlike 0064 to 0066: this file creates a NEW table and alters
-- a FUNCTION. It takes no lock on any existing table (ALTER FUNCTION locks the
-- function's own catalogue row, not the tables whose CHECKs call it), so there
-- is nothing to take all-or-none and nothing a request can queue behind.
--
-- NAMES are the exact drizzle spellings, double-quoted (0053's header;
-- migration-catalogue.test.ts).
CREATE TABLE "sign_in_failures" (
  "identifier_hash" text PRIMARY KEY NOT NULL,
  "window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "failures" smallint DEFAULT 1 NOT NULL,
  CONSTRAINT "sign_in_failures_identifier_hash_shape" CHECK (identifier_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "sign_in_failures_failures_range" CHECK (failures between 1 and 100)
);

-- Closed from birth (the 0064 rule): RLS on, and forced, before the batch
-- commits.
ALTER TABLE "sign_in_failures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sign_in_failures" FORCE ROW LEVEL SECURITY;

CREATE INDEX "sign_in_failures_window_started_idx" ON "sign_in_failures" USING btree ("window_started_at");

ALTER FUNCTION public.text_has_visible_character(text) SET search_path = '';
