-- 0062: the market seed book. SCHEMA ONLY: one new platform-level table. No
-- data touched, no backfill, no policy, no grant, no trigger, no apply-rls
-- function referenced (RLS and the SELECT-only grant live in
-- rls/policies/60-market.sql and rls/roles.sql, applied by `db:apply-rls`
-- AFTER this file).
--
-- WHAT IT ADDS. `market_seed_book`: every published market item as a studio's
-- price book would receive it (code, names, studio unit, cost and cost x 1.05,
-- the forms a studio's own item clashes with, its sub-category), built by the
-- one seed implementation (src/market-seed/book.ts). A DERIVED copy that
-- `market:publish`, `market:withdraw` and `market:seed-price-books` rebuild
-- whole, so the app can seed a new studio inside a Worker's CPU budget. It
-- starts EMPTY: until one of those three commands runs, the app seeds nothing
-- (the same as before this migration).
--
-- THE ENUM RULE OF 0061 HOLDS: the `unit` column is typed cost_item_unit, and
-- no statement here names a label (migration-enum-values.test.ts).
--
-- LOCKS. One CREATE TABLE on a new, empty relation, plus its FK to
-- market_items (SHARE ROW EXCLUSIVE on market_items for the instant of the
-- ADD; no app path writes market_items). Well inside the migrator's 3 s
-- lock_timeout. An estimate, not a production measurement.
CREATE TABLE "market_seed_book" (
  "item_id" uuid PRIMARY KEY NOT NULL,
  "position" integer NOT NULL,
  "code" text NOT NULL,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "name_forms" text[] NOT NULL,
  "status" "market_item_status" NOT NULL,
  "unit" "cost_item_unit",
  "unit_cost" numeric(18, 4),
  "unit_price" numeric(18, 4),
  "leaf_key" text NOT NULL,
  "leaf_name_ar" text NOT NULL,
  "leaf_name_en" text NOT NULL,
  "top_name_ar" text NOT NULL,
  "top_name_en" text NOT NULL,
  "built_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "market_seed_book_position_unique" UNIQUE ("position"),
  CONSTRAINT "market_seed_book_code_unique" UNIQUE ("code"),
  CONSTRAINT "market_seed_book_code_format" CHECK ("code" like 'MKT-%'),
  CONSTRAINT "market_seed_book_names_present" CHECK (btrim("name_ar") <> '' AND btrim("name_en") <> ''),
  CONSTRAINT "market_seed_book_prices" CHECK (("unit_cost" is null) = ("unit_price" is null) and coalesce("unit_cost", 0) >= 0 and coalesce("unit_price", 0) >= 0),
  CONSTRAINT "market_seed_book_item_id_market_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."market_items"("id") ON DELETE CASCADE
);
