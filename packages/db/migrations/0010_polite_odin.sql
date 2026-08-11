CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"number" integer NOT NULL,
	"title_ar" text,
	"title_en" text,
	"client_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"discount_pct" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(18, 4) DEFAULT '14' NOT NULL,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"taxable_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_margin" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes_ar" text,
	"notes_en" text,
	"terms_ar" text,
	"terms_en" text,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"token_hash" text,
	"share_expires_at" timestamp with time zone,
	CONSTRAINT "proposals_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "proposals_org_id_number_unique" UNIQUE("org_id","number"),
	CONSTRAINT "proposals_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "proposals_title_present" CHECK (length(regexp_replace(coalesce("title_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("title_en", ''), '[[:space:]]', '', 'g')) > 0),
	CONSTRAINT "proposals_expiry_after_issue" CHECK (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"title_ar" text,
	"title_en" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"section_subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "proposal_sections_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "proposal_sections_title_present" CHECK (length(regexp_replace(coalesce("title_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("title_en", ''), '[[:space:]]', '', 'g')) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"cost_item_id" uuid,
	"description_ar" text,
	"description_en" text,
	"qty" numeric(18, 4) NOT NULL,
	"unit" "cost_item_unit" NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_pct" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"line_margin" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "proposal_lines_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "proposal_lines_description_present" CHECK (length(regexp_replace(coalesce("description_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("description_en", ''), '[[:space:]]', '', 'g')) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"ip" text,
	"user_agent" text,
	"from_status" text,
	"to_status" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_events_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_same_org_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_same_org_fk" FOREIGN KEY ("org_id","project_id") REFERENCES "public"."projects"("org_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_supersedes_same_org_fk" FOREIGN KEY ("org_id","supersedes_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_sections" ADD CONSTRAINT "proposal_sections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_sections" ADD CONSTRAINT "proposal_sections_proposal_same_org_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_proposal_same_org_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_section_same_org_fk" FOREIGN KEY ("org_id","section_id") REFERENCES "public"."proposal_sections"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_lines" ADD CONSTRAINT "proposal_lines_costItem_same_org_fk" FOREIGN KEY ("org_id","cost_item_id") REFERENCES "public"."cost_items"("org_id","id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_same_org_fk" FOREIGN KEY ("org_id","proposal_id") REFERENCES "public"."proposals"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_client_idx" ON "proposals" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_project_idx" ON "proposals" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_supersedes_idx" ON "proposals" USING btree ("org_id","supersedes_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_org_status_idx" ON "proposals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_org_project_idx" ON "proposals" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_sections_proposal_idx" ON "proposal_sections" USING btree ("org_id","proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_sections_org_proposal_sort_idx" ON "proposal_sections" USING btree ("org_id","proposal_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_lines_proposal_idx" ON "proposal_lines" USING btree ("org_id","proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_lines_section_idx" ON "proposal_lines" USING btree ("org_id","section_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_lines_costItem_idx" ON "proposal_lines" USING btree ("org_id","cost_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_lines_org_section_sort_idx" ON "proposal_lines" USING btree ("org_id","section_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_proposal_idx" ON "proposal_events" USING btree ("org_id","proposal_id");