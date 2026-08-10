ALTER TABLE "organizations" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tax_registration_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hide_margin_from_pm" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "restrict_firm_dashboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
