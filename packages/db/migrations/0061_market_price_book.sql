-- 0061: the market price book. SCHEMA ONLY: five cost_item_unit labels, five
-- new enum types, five new platform-level tables, one nullable column on
-- cost_items with its FK and index. No data touched, no backfill, no policy, no
-- grant, no trigger, no apply-rls function referenced (RLS and the SELECT-only
-- grant for the five tables live in rls/policies/60-market.sql and
-- rls/roles.sql, applied by `db:apply-rls` AFTER this file).
--
-- WHAT IT ADDS.
--   * `cost_item_unit` gains kg, ton, liter, cbm and roll (owner decision D3),
--     so supply items priced by weight, volume or roll can sit in a price book.
--     IRREVERSIBLE: Postgres cannot drop an enum label. Harmless if unused.
--   * market_categories, market_items, market_bulletins,
--     market_price_observations and market_item_details: the Ministry of
--     Housing's monthly building-materials guide prices. NO org_id: every studio reads them, only
--     the owner's `market:publish` CLI writes them (as the BYPASSRLS connection
--     role, the same trust boundary as `db:migrate`).
--   * cost_items.market_item_id: an ADVISORY link to a market item; market data
--     never changes a cost or a price.
--
-- THE ADD VALUEs, AND THE ONE RULE THAT KEEPS THEM SAFE. `db:migrate` runs every
-- pending migration in ONE transaction (drizzle's migrator), and a fresh
-- database (CI) replays ALL of them in that one transaction. PostgreSQL 12+
-- allows `ALTER TYPE ... ADD VALUE` inside a transaction block, but a label
-- added there cannot be USED until the transaction commits (55P04, unsafe use
-- of new value). So the five statements are TOP-LEVEL (never inside a DO block,
-- where PL/pgSQL forbids them), and no statement in this file or any later
-- migration names the new labels: the first use is application code.
-- migration-enum-values.test.ts enforces both, for every ADD VALUE in the
-- folder. The guard below makes a server older than 12 (where ADD VALUE inside
-- a transaction block is refused outright) fail with a sentence instead of a
-- bare error. Supabase and CI run 17. Same shape as 0028, 0033, 0042 and 0048.
--
-- LOCKS. Five CREATE TABLEs on new, empty relations. ADD COLUMN with no default
-- is metadata-only. The FK is added NOT VALID (no scan while holding the lock)
-- and then VALIDATEd (SHARE UPDATE EXCLUSIVE; the column is all NULL, so the
-- scan finds nothing to check), the 0052 pattern. The partial index on
-- cost_items is a plain CREATE INDEX on a table of low thousands of rows per
-- org, well inside the migrator's 3 s lock_timeout. Estimates, not production
-- measurements.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 120000 THEN
    RAISE EXCEPTION '0061 needs PostgreSQL 12 or later (ALTER TYPE ... ADD VALUE inside the migrator transaction); found %', current_setting('server_version');
  END IF;
END $$;
--> statement-breakpoint
ALTER TYPE public.cost_item_unit ADD VALUE IF NOT EXISTS 'kg';
--> statement-breakpoint
ALTER TYPE public.cost_item_unit ADD VALUE IF NOT EXISTS 'ton';
--> statement-breakpoint
ALTER TYPE public.cost_item_unit ADD VALUE IF NOT EXISTS 'liter';
--> statement-breakpoint
ALTER TYPE public.cost_item_unit ADD VALUE IF NOT EXISTS 'cbm';
--> statement-breakpoint
ALTER TYPE public.cost_item_unit ADD VALUE IF NOT EXISTS 'roll';
--> statement-breakpoint
CREATE TYPE "public"."market_publisher" AS ENUM ('mhuc_cabm');
CREATE TYPE "public"."market_bulletin_status" AS ENUM ('published', 'withdrawn');
CREATE TYPE "public"."market_unit" AS ENUM ('ton', 'kg', 'sqm', 'cbm', 'linear_meter', 'liter', 'pcs', 'roll', 'bag', 'pack', 'thousand_bricks');
CREATE TYPE "public"."market_item_status" AS ENUM ('active', 'discontinued');
CREATE TYPE "public"."market_observation_status" AS ENUM ('priced', 'suspended');

CREATE TABLE "market_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "parent_id" uuid,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "sort_order" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "market_categories_key_unique" UNIQUE ("key"),
  CONSTRAINT "market_categories_key_format" CHECK ("key" ~ '^[a-z_]+(\.[a-z_]+)?$'),
  CONSTRAINT "market_categories_parent_iff_leaf" CHECK (("parent_id" IS NULL) = (strpos("key", '.') = 0)),
  CONSTRAINT "market_categories_names_present" CHECK (btrim("name_ar") <> '' AND btrim("name_en") <> ''),
  CONSTRAINT "market_categories_parent_id_market_categories_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "public"."market_categories"("id") ON DELETE RESTRICT
);
CREATE INDEX "market_categories_parent_idx" ON "market_categories" USING btree ("parent_id");

CREATE TABLE "market_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "category_id" uuid NOT NULL,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "spec_ar" text,
  "spec_en" text,
  "unit" "market_unit" NOT NULL,
  "unit_label_ar" text NOT NULL,
  "pack_length_m" numeric(10, 3),
  "pack_pieces" integer,
  "pack_piece_length_m" numeric(10, 3),
  "basis_note_ar" text,
  "source_labels" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" "market_item_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "market_items_key_unique" UNIQUE ("key"),
  CONSTRAINT "market_items_key_format" CHECK ("key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+){2,}$'),
  CONSTRAINT "market_items_names_present" CHECK (btrim("name_ar") <> '' AND btrim("name_en") <> ''),
  -- A roll carries its pack size and nothing else does. `unit::text`, because
  -- 'roll' is also one of the cost_item_unit labels added above (the rule in the
  -- header: a text comparison is not a use of the new label).
  CONSTRAINT "market_items_pack_iff_roll" CHECK (("unit"::text = 'roll') = ("pack_length_m" IS NOT NULL OR "pack_pieces" IS NOT NULL)),
  CONSTRAINT "market_items_pack_shape" CHECK (
    ("pack_length_m" IS NOT NULL AND "pack_length_m" > 0 AND "pack_pieces" IS NULL AND "pack_piece_length_m" IS NULL)
    OR ("pack_length_m" IS NULL AND ("pack_pieces" IS NULL) = ("pack_piece_length_m" IS NULL)
        AND coalesce("pack_pieces", 1) > 0 AND coalesce("pack_piece_length_m", 1) > 0)
  ),
  CONSTRAINT "market_items_category_id_market_categories_id_fk"
    FOREIGN KEY ("category_id") REFERENCES "public"."market_categories"("id") ON DELETE RESTRICT
);
CREATE INDEX "market_items_category_idx" ON "market_items" USING btree ("category_id");

CREATE TABLE "market_bulletins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "publisher" "market_publisher" NOT NULL,
  "period_month" date NOT NULL,
  "status" "market_bulletin_status" NOT NULL,
  "source_pdf_file_name" text,
  "source_pdf_sha256" text,
  "source_md_file_name" text,
  "source_md_sha256" text,
  "source_page_count" integer NOT NULL,
  "region_key" text DEFAULT 'greater_cairo' NOT NULL,
  "collection_from_day" smallint DEFAULT 14 NOT NULL,
  "collection_to_day" smallint DEFAULT 16 NOT NULL,
  "includes_taxes" boolean DEFAULT true NOT NULL,
  "includes_transport" boolean DEFAULT false NOT NULL,
  "published_on" date,
  "extraction_method" text NOT NULL,
  "extraction_sha256" text NOT NULL,
  "gate_commit" text NOT NULL,
  "discontinued_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  "reviewed_by" text NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  "withdrawn_reason" text,
  CONSTRAINT "market_bulletins_period_first_day" CHECK (extract(day from "period_month") = 1),
  CONSTRAINT "market_bulletins_pdf_sha256_format" CHECK (source_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "market_bulletins_md_sha256_format" CHECK (source_md_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "market_bulletins_extraction_sha256_format" CHECK (extraction_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "market_bulletins_gate_commit_format" CHECK ("gate_commit" ~ '^[0-9a-f]{40}$'),
  CONSTRAINT "market_bulletins_id_period_unique" UNIQUE ("id", "period_month"),
  CONSTRAINT "market_bulletins_pdf_named" CHECK (("source_pdf_file_name" IS NULL) = ("source_pdf_sha256" IS NULL)),
  CONSTRAINT "market_bulletins_md_named" CHECK (("source_md_file_name" IS NULL) = ("source_md_sha256" IS NULL)),
  CONSTRAINT "market_bulletins_extraction_method" CHECK (
    ("extraction_method" = 'session:pdf' AND "source_pdf_sha256" IS NOT NULL)
    OR ("extraction_method" = 'session:md' AND "source_md_sha256" IS NOT NULL)
  ),
  CONSTRAINT "market_bulletins_page_count_positive" CHECK ("source_page_count" > 0),
  CONSTRAINT "market_bulletins_collection_days" CHECK (
    1 <= "collection_from_day" AND "collection_from_day" <= "collection_to_day" AND "collection_to_day" <= 31
  ),
  CONSTRAINT "market_bulletins_reviewer_present" CHECK (btrim("reviewed_by") <> ''),
  CONSTRAINT "market_bulletins_withdrawn_iff_reason" CHECK (
    ("status" = 'withdrawn') = ("withdrawn_at" IS NOT NULL AND "withdrawn_reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "market_bulletins_one_published_per_period"
  ON "market_bulletins" USING btree ("publisher", "period_month") WHERE "status" = 'published';

CREATE TABLE "market_price_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_id" uuid NOT NULL,
  "bulletin_id" uuid NOT NULL,
  "bulletin_period_month" date NOT NULL,
  "period_month" date NOT NULL,
  "status" "market_observation_status" NOT NULL,
  "price" numeric(18, 4),
  "source_pdf_page" integer,
  "source_printed_page" integer,
  CONSTRAINT "market_price_observations_item_month_bulletin_unique" UNIQUE ("item_id", "period_month", "bulletin_id"),
  CONSTRAINT "market_price_observations_period_first_day" CHECK (extract(day from "period_month") = 1),
  CONSTRAINT "market_price_observations_priced_iff_price" CHECK (("status" = 'priced') = ("price" IS NOT NULL)),
  -- The gate's B1 and B2, again at the database: a value the checker would
  -- refuse cannot be stored whatever wrote it (the publish CLI is the only
  -- writer, but its input is a file).
  CONSTRAINT "market_price_observations_price_range" CHECK ("price" > 0 AND "price" <= 10000000),
  CONSTRAINT "market_price_observations_month_not_after_bulletin" CHECK ("period_month" <= "bulletin_period_month"),
  CONSTRAINT "market_price_observations_source_page" CHECK (
    ("source_pdf_page" IS NOT NULL OR "source_printed_page" IS NOT NULL)
    AND coalesce("source_pdf_page", 1) > 0 AND coalesce("source_printed_page", 1) > 0
  ),
  CONSTRAINT "market_price_observations_item_id_market_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."market_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "market_price_observations_bulletin_period_fk"
    FOREIGN KEY ("bulletin_id", "bulletin_period_month") REFERENCES "public"."market_bulletins"("id", "period_month") ON DELETE RESTRICT
);
CREATE INDEX "market_price_observations_item_month_idx"
  ON "market_price_observations" USING btree ("item_id", "period_month" DESC);
CREATE INDEX "market_price_observations_bulletin_idx"
  ON "market_price_observations" USING btree ("bulletin_id");

CREATE TABLE "market_item_details" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "item_id" uuid NOT NULL,
  "bulletin_id" uuid NOT NULL,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "spec_ar" text,
  "spec_en" text,
  "unit_label_ar" text NOT NULL,
  "basis_note_ar" text,
  CONSTRAINT "market_item_details_item_bulletin_unique" UNIQUE ("item_id", "bulletin_id"),
  CONSTRAINT "market_item_details_names_present" CHECK (btrim("name_ar") <> '' AND btrim("name_en") <> ''),
  CONSTRAINT "market_item_details_item_id_market_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."market_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "market_item_details_bulletin_id_market_bulletins_id_fk"
    FOREIGN KEY ("bulletin_id") REFERENCES "public"."market_bulletins"("id") ON DELETE RESTRICT
);
CREATE INDEX "market_item_details_bulletin_idx"
  ON "market_item_details" USING btree ("bulletin_id");

ALTER TABLE "cost_items" ADD COLUMN "market_item_id" uuid;
ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_market_item_id_market_items_id_fk"
  FOREIGN KEY ("market_item_id") REFERENCES "public"."market_items"("id") ON DELETE RESTRICT NOT VALID;
ALTER TABLE "cost_items" VALIDATE CONSTRAINT "cost_items_market_item_id_market_items_id_fk";
CREATE INDEX "cost_items_org_market_item_idx"
  ON "cost_items" USING btree ("org_id", "market_item_id") WHERE "market_item_id" IS NOT NULL;
