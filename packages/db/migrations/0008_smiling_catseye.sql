CREATE TYPE "public"."cost_item_category" AS ENUM('civil', 'gypsum', 'electrical', 'plumbing', 'joinery', 'finishes', 'furniture', 'preliminaries');--> statement-breakpoint
CREATE TYPE "public"."cost_item_unit" AS ENUM('sqm', 'linear_meter', 'pcs', 'lump_sum', 'day');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"name_en" text,
	"category" "cost_item_category" NOT NULL,
	"unit" "cost_item_unit" NOT NULL,
	"default_unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"default_unit_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_code" text,
	"eta_item_code" text,
	"eta_code_type" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "cost_items_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "cost_items_org_id_code_unique" UNIQUE("org_id","code"),
	CONSTRAINT "cost_items_name_present" CHECK (length(regexp_replace(coalesce("name_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("name_en", ''), '[[:space:]]', '', 'g')) > 0),
	CONSTRAINT "cost_items_default_unit_cost_nonneg" CHECK ("cost_items"."default_unit_cost" >= 0),
	CONSTRAINT "cost_items_default_unit_price_nonneg" CHECK ("cost_items"."default_unit_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_change_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_change_id" uuid NOT NULL,
	"cost_item_id" uuid NOT NULL,
	"old_unit_cost" numeric(18, 4) NOT NULL,
	"new_unit_cost" numeric(18, 4) NOT NULL,
	"old_unit_price" numeric(18, 4) NOT NULL,
	"new_unit_price" numeric(18, 4) NOT NULL,
	CONSTRAINT "price_change_lines_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "cost_item_category" NOT NULL,
	"pct_change" numeric(9, 4) NOT NULL,
	"target" text NOT NULL,
	"effective_date" date NOT NULL,
	"applied_by" uuid NOT NULL,
	"item_count" integer NOT NULL,
	CONSTRAINT "price_changes_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_items" ADD CONSTRAINT "cost_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_change_lines" ADD CONSTRAINT "price_change_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_change_lines" ADD CONSTRAINT "price_change_lines_priceChange_same_org_fk" FOREIGN KEY ("org_id","price_change_id") REFERENCES "public"."price_changes"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_change_lines" ADD CONSTRAINT "price_change_lines_costItem_same_org_fk" FOREIGN KEY ("org_id","cost_item_id") REFERENCES "public"."cost_items"("org_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_items_org_category_idx" ON "cost_items" USING btree ("org_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_items_org_active_idx" ON "cost_items" USING btree ("org_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_change_lines_priceChange_idx" ON "price_change_lines" USING btree ("org_id","price_change_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_change_lines_costItem_idx" ON "price_change_lines" USING btree ("org_id","cost_item_id");