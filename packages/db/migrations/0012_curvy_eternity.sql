CREATE TABLE IF NOT EXISTS "proposal_section_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name_ar" text,
	"name_en" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "proposal_section_library_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "proposal_section_library_name_present" CHECK (length(regexp_replace(coalesce("name_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("name_en", ''), '[[:space:]]', '', 'g')) > 0)
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "supervision_pct" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "supervision_amount" numeric(18, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_section_library" ADD CONSTRAINT "proposal_section_library_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_section_library_org_active_idx" ON "proposal_section_library" USING btree ("org_id","active");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_supervision_pct_range" CHECK (supervision_pct >= 0 and supervision_pct <= 100);