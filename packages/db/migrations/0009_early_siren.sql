CREATE TYPE "public"."project_status" AS ENUM('draft', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name_ar" text,
	"name_en" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"city" text,
	"address" text,
	"tax_registration_number" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "clients_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "clients_name_present" CHECK (length(regexp_replace(coalesce("name_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("name_en", ''), '[[:space:]]', '', 'g')) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"name_ar" text,
	"name_en" text,
	"client_id" uuid NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"city" text,
	"address" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "projects_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "projects_org_id_code_unique" UNIQUE("org_id","code"),
	CONSTRAINT "projects_name_present" CHECK (length(regexp_replace(coalesce("name_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("name_en", ''), '[[:space:]]', '', 'g')) > 0),
	CONSTRAINT "projects_date_order" CHECK (end_date is null or start_date is null or end_date >= start_date)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_client_same_org_fk" FOREIGN KEY ("org_id","client_id") REFERENCES "public"."clients"("org_id","id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_org_active_idx" ON "clients" USING btree ("org_id","active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_client_idx" ON "projects" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_status_idx" ON "projects" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_active_idx" ON "projects" USING btree ("org_id","active");