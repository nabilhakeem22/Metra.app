-- 0064: Stage 3, the site diary (DB step S). SCHEMA ONLY and ADDITIVE: five
-- new enum types, one pure text helper, seven new org-scoped tables, two
-- existing tables altered. No row is updated, nothing is backfilled, no policy,
-- no grant, no trigger and no apply-rls function is referenced (the policies,
-- grants, the restrictive policies and the guard triggers live in
-- rls/policies/70-site.sql, rls/policies/10-catalogue.sql, rls/functions/
-- 80-site.sql, rls/functions/85-site-portal.sql, rls/functions/00-org-context.sql
-- and rls/roles.sql, applied by `db:apply-rls` AFTER this file).
--
-- WHAT IT ADDS.
--   * projects: the SITE PIN, five nullable columns (site_lat, site_lng,
--     site_radius_m, site_pin_set_by, site_pin_set_at), set together or not at
--     all (`projects_site_pin_shape`) and within range (`projects_site_pin_range`).
--     Every existing row has all five null, so both CHECKs hold for it.
--   * contracts: unique (org_id, project_id, id), the target of the site
--     diary's 3-column FK: a material delivery names an execution contract of
--     ITS OWN project.
--   * text_has_visible_character(text): the ONE "present text" rule of the
--     diary's CHECKs (a material's description, a note's body): at least one
--     character that is neither white space nor an invisible format character
--     (the bidi marks RLM, LRM and ALM, the joiners, the word joiner, the soft
--     hyphen, tatweel, NEL, the Mongolian vowel separator, the bidi embeddings
--     and isolates, the invisible operators). An Arabic keyboard can type an
--     entry of RLMs only, which reads as empty in the studio's feed.
--   * project_assignments (who works on which site), site_location_consents
--     (PDPL consent per studio and text version), site_devices (a phone's auth
--     session per studio), site_visits (check-in, the one location reading,
--     the presence verdict, the client publication), site_photos,
--     site_material_receipts and site_notes.
--   * A PHOTO STORES NO OBJECT KEY. Its two keys, `{org_id}/site/{project_id}/
--     {id}-d.jpg` and `-t.jpg`, are a pure function of the row
--     (rls/functions/80-site.sql `site_photo_object_key`, and its TypeScript
--     twin lib/site/photo-object-key.ts), so they cannot point outside the
--     row's own studio and project, and cost no bytes: storing them, with their
--     CHECK and a global unique index, was half of every photo row (S2
--     reliability R1).
--   * 3-COLUMN FKs make "of THIS project" a database fact: a photo's, a
--     material's and a note's visit (org_id, project_id, visit_id), a
--     material's contract (org_id, project_id, contract_id) and line
--     (org_id, contract_id, contract_line_id), and a material's photo
--     (org_id, project_id, photo_id).
--   * RLS IS ENABLED AND FORCED on the seven new tables HERE, in the batch that
--     creates them (S2 security S5): with no policy yet, metra_app reads and
--     writes nothing in them, so an apply-rls that stops half way leaves them
--     closed, never open. apply-rls adds the policies and the grants.
--
-- THE ONE SET NULL FK IS BORN NARROWED (the 0052 rule):
-- `site_material_receipts_photo_same_project_fk` carries `ON DELETE SET NULL
-- (photo_id)`. The straggler check at the end of this file refuses the whole
-- batch if any composite set-null FK in `public` still lacks its column list.
--
-- THE CHECKS ON projects go in NOT VALID and are then VALIDATEd, the 0052
-- pattern: a violating row fails at VALIDATE with the constraint's name, and
-- the batch rolls back whole.
--
-- LOCKS, ALL OR NONE. `db:migrate` runs the batch as ONE transaction. The first
-- block takes EVERY lock this file needs on an EXISTING table, ACCESS EXCLUSIVE
-- on projects and contracts and SHARE ROW EXCLUSIVE on contract_lines and
-- organizations (the new tables' FKs), as ONE attempt of four `LOCK TABLE ...
-- NOWAIT` inside a subtransaction. An attempt that meets a busy table rolls
-- back, which RELEASES the locks it already took, sleeps 10 to 40 ms and tries
-- again, within ONE 3 s budget in all; a spent budget is 55P03 and the batch
-- rolls back whole. So the migration never holds `projects` while it waits for
-- `contracts`: a studio request that reads contracts and then projects (the
-- contracts list) can no longer deadlock with it (40P01 in 3 to 10 % of runs at
-- pilot traffic with the one-at-a-time waits, S2 reliability R2). Then, held
-- to the commit:
--   projects   five metadata-only ADD COLUMNs (no default) and two CHECK
--              validations, each one scan of the table;
--   contracts  one unique index build.
-- The new tables are created empty, so their FKs validate nothing. The
-- measured figures are in docs/DEPLOY.md (site diary DB step S).
--
-- ENUMS. Five CREATE TYPEs, used by the tables below in the same file: legal
-- (only `ALTER TYPE ... ADD VALUE` has the commit-before-use rule of 0061).
-- `market_unit` (0061) is reused as it is; no label of it is named here.
--
-- NAMES are the exact drizzle spellings; camelCase ones are DOUBLE-QUOTED so
-- Postgres keeps them (0053's header; migration-catalogue.test.ts).
DO $$
DECLARE
  lock_started constant timestamptz := clock_timestamp();
  lock_targets constant text[] := array[
    'public.projects:ACCESS EXCLUSIVE',
    'public.contracts:ACCESS EXCLUSIVE',
    'public.contract_lines:SHARE ROW EXCLUSIVE',
    'public.organizations:SHARE ROW EXCLUSIVE'
  ];
  lock_target  text;
BEGIN
  -- EVERY LOCK, ALL OR NONE, within ONE 3 s budget for all the attempts
  -- together. The inner BEGIN ... EXCEPTION is a subtransaction: when one
  -- NOWAIT finds its table busy, the locks this attempt already took are
  -- released with it, so nothing is held between attempts.
  LOOP
    BEGIN
      FOREACH lock_target IN ARRAY lock_targets LOOP
        EXECUTE format('LOCK TABLE %s IN %s MODE NOWAIT', split_part(lock_target, ':', 1), split_part(lock_target, ':', 2));
      END LOOP;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() - lock_started >= interval '3 seconds' THEN
        RAISE EXCEPTION '0064: could not take every lock within 3 s (stopped at %)', lock_target
          USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.01 + random() * 0.03);
    END;
  END LOOP;
  -- Every lock is held now; the statements below wait on nothing.

  ALTER TABLE public.projects ADD COLUMN site_lat numeric(9, 6);
  ALTER TABLE public.projects ADD COLUMN site_lng numeric(9, 6);
  ALTER TABLE public.projects ADD COLUMN site_radius_m integer;
  ALTER TABLE public.projects ADD COLUMN site_pin_set_by uuid;
  ALTER TABLE public.projects ADD COLUMN site_pin_set_at timestamp with time zone;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_site_pin_shape
    CHECK (num_nonnulls(site_lat, site_lng, site_radius_m, site_pin_set_by, site_pin_set_at) in (0, 5)) NOT VALID;
  ALTER TABLE public.projects VALIDATE CONSTRAINT projects_site_pin_shape;
  ALTER TABLE public.projects
    ADD CONSTRAINT projects_site_pin_range
    CHECK (site_lat between -90 and 90 and site_lng between -180 and 180 and site_radius_m between 30 and 2000) NOT VALID;
  ALTER TABLE public.projects VALIDATE CONSTRAINT projects_site_pin_range;

  ALTER TABLE public.contracts
    ADD CONSTRAINT contracts_org_project_id_unique UNIQUE (org_id, project_id, id);
END $$;

CREATE TYPE "public"."site_location_status" AS ENUM ('fixed', 'denied', 'unavailable', 'timeout', 'unsupported', 'declined');
CREATE TYPE "public"."site_presence" AS ENUM ('on_site', 'off_site', 'uncertain', 'no_location', 'no_site_pin');
CREATE TYPE "public"."site_photo_source" AS ENUM ('camera', 'gallery');
CREATE TYPE "public"."site_photo_status" AS ENUM ('pending', 'stored');
CREATE TYPE "public"."site_note_kind" AS ENUM ('progress', 'issue', 'request');

-- The diary's "present text" rule (S2 functional F4), used by the CHECKs on
-- site_material_receipts.description and site_notes.body. A pure function of
-- its argument (IMMUTABLE), so a CHECK may call it; the SQL-standard body is
-- bound when it is created, and the operator is schema-qualified, so no
-- search_path can change what it answers. The bracket is written as \u escapes
-- (the regex engine's own), so this file holds no invisible character:
--   [:space:]            ASCII and Unicode white space
--   00a0 1680 2000-200a  the no-break and typographic spaces
--   202f 205f 3000       the narrow, medium and ideographic spaces
--   200b-200f            zero width space, ZWNJ, ZWJ, LRM, RLM
--   2028 2029            line and paragraph separators
--   202a-202e 2066-2069  bidi embeddings, overrides and isolates
--   2060-2064            word joiner and the invisible operators
--   206a-206f            the deprecated format characters
--   00ad 034f 061c 0640  soft hyphen, CGJ, ALM, tatweel
--   0085 180e feff       NEL, Mongolian vowel separator, BOM
CREATE FUNCTION public.text_has_visible_character(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURN value OPERATOR(pg_catalog.~) '[^[:space:]\u00a0\u00ad\u0085\u034f\u061c\u0640\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u2066-\u206f\u3000\ufeff]';

CREATE TABLE "project_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "assigned_by" uuid NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  CONSTRAINT "project_assignments_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "project_assignments_revoke_pair" CHECK ((revoked_at is null) = (revoked_by is null))
);
CREATE INDEX "project_assignments_project_idx" ON "project_assignments" USING btree ("org_id", "project_id");
CREATE UNIQUE INDEX "project_assignments_one_live" ON "project_assignments" USING btree ("org_id", "project_id", "user_id") WHERE revoked_at is null;
CREATE INDEX "project_assignments_org_user_live_idx" ON "project_assignments" USING btree ("org_id", "user_id") WHERE revoked_at is null;

CREATE TABLE "site_location_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid NOT NULL,
  "policy_version" smallint NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "withdrawn_at" timestamp with time zone,
  CONSTRAINT "site_location_consents_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_location_consents_policy_version_positive" CHECK (policy_version > 0)
);
CREATE UNIQUE INDEX "site_location_consents_one_live" ON "site_location_consents" USING btree ("org_id", "user_id") WHERE withdrawn_at is null;

CREATE TABLE "site_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" uuid NOT NULL,
  "auth_session_id" uuid NOT NULL,
  "label" text NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" uuid,
  CONSTRAINT "site_devices_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_devices_org_session_unique" UNIQUE ("org_id", "auth_session_id"),
  CONSTRAINT "site_devices_label_length" CHECK (char_length(label) between 1 and 80),
  CONSTRAINT "site_devices_revoke_pair" CHECK ((revoked_at is null) = (revoked_by is null))
);
CREATE INDEX "site_devices_org_user_idx" ON "site_devices" USING btree ("org_id", "user_id");

CREATE TABLE "site_visits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "client_key" uuid NOT NULL,
  "visit_date" date NOT NULL,
  "checked_in_at" timestamp with time zone NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_out_at" timestamp with time zone,
  "location_status" "site_location_status" NOT NULL,
  "lat" numeric(9, 6),
  "lng" numeric(9, 6),
  "accuracy_m" integer,
  "presence" "site_presence" NOT NULL,
  "distance_m" integer,
  "no_location_reason" text,
  "published_at" timestamp with time zone,
  "published_by" uuid,
  "client_caption_ar" text,
  "client_caption_en" text,
  CONSTRAINT "site_visits_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_visits_org_client_key_unique" UNIQUE ("org_id", "client_key"),
  CONSTRAINT "site_visits_org_project_id_unique" UNIQUE ("org_id", "project_id", "id"),
  CONSTRAINT "site_visits_checkout_order" CHECK (checked_out_at is null or checked_out_at >= checked_in_at),
  CONSTRAINT "site_visits_fix_shape" CHECK ((location_status = 'fixed') = (accuracy_m is not null) and (lat is null) = (lng is null) and (lat is null or location_status = 'fixed')),
  CONSTRAINT "site_visits_coordinates_range" CHECK (lat between -90 and 90 and lng between -180 and 180 and accuracy_m between 0 and 100000),
  CONSTRAINT "site_visits_verdict_shape" CHECK ((distance_m is null) = (presence in ('no_location', 'no_site_pin')) and distance_m >= 0 and (presence = 'no_location') = (location_status <> 'fixed' and presence <> 'no_site_pin')),
  CONSTRAINT "site_visits_reason_length" CHECK (char_length(no_location_reason) <= 200),
  CONSTRAINT "site_visits_publish_pair" CHECK ((published_at is null) = (published_by is null)),
  CONSTRAINT "site_visits_caption_length" CHECK (char_length(client_caption_ar) <= 500 and char_length(client_caption_en) <= 500)
);
CREATE INDEX "site_visits_org_project_feed_idx" ON "site_visits" USING btree ("org_id", "project_id", "visit_date" DESC, "checked_in_at" DESC, "id" DESC);
CREATE INDEX "site_visits_org_user_date_idx" ON "site_visits" USING btree ("org_id", "user_id", "visit_date" DESC);
CREATE INDEX "site_visits_org_project_published_idx" ON "site_visits" USING btree ("org_id", "project_id", "visit_date" DESC) WHERE published_at is not null;

CREATE TABLE "site_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "project_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "client_key" uuid NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "storage_provider" text NOT NULL,
  "display_bytes" integer NOT NULL,
  "thumb_bytes" integer NOT NULL,
  "width" smallint NOT NULL,
  "height" smallint NOT NULL,
  "content_type" text NOT NULL,
  "taken_at" timestamp with time zone NOT NULL,
  "source" "site_photo_source" NOT NULL,
  "caption" text,
  "status" "site_photo_status" DEFAULT 'pending' NOT NULL,
  "client_visible" boolean DEFAULT false NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  CONSTRAINT "site_photos_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_photos_org_client_key_unique" UNIQUE ("org_id", "client_key"),
  CONSTRAINT "site_photos_org_project_id_unique" UNIQUE ("org_id", "project_id", "id"),
  CONSTRAINT "site_photos_storage_provider" CHECK (storage_provider in ('r2', 'supabase')),
  CONSTRAINT "site_photos_display_bytes_range" CHECK (display_bytes between 1 and 1048576),
  CONSTRAINT "site_photos_thumb_bytes_range" CHECK (thumb_bytes between 1 and 131072),
  CONSTRAINT "site_photos_dimensions_range" CHECK (width between 1 and 4096 and height between 1 and 4096),
  CONSTRAINT "site_photos_content_type" CHECK (content_type = 'image/jpeg'),
  CONSTRAINT "site_photos_caption_length" CHECK (char_length(caption) <= 300),
  CONSTRAINT "site_photos_visible_is_stored" CHECK (not client_visible or status = 'stored'),
  CONSTRAINT "site_photos_void_pair" CHECK ((voided_at is null) = (voided_by is null)),
  CONSTRAINT "site_photos_visible_not_void" CHECK (not (client_visible and voided_at is not null))
);
CREATE INDEX "site_photos_org_visit_idx" ON "site_photos" USING btree ("org_id", "visit_id");
CREATE INDEX "site_photos_org_project_created_idx" ON "site_photos" USING btree ("org_id", "project_id", "created_at" DESC);

CREATE TABLE "site_material_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "project_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "client_key" uuid NOT NULL,
  "recorded_by" uuid NOT NULL,
  "description" text NOT NULL,
  "qty" numeric(18, 4) NOT NULL,
  "unit" "market_unit" NOT NULL,
  "contract_id" uuid,
  "contract_line_id" uuid,
  "supplier" text,
  "note" text,
  "photo_id" uuid,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  CONSTRAINT "site_material_receipts_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_material_receipts_org_client_key_unique" UNIQUE ("org_id", "client_key"),
  CONSTRAINT "site_material_receipts_description_present" CHECK (public.text_has_visible_character(description) and char_length(description) <= 200),
  CONSTRAINT "site_material_receipts_qty_positive" CHECK (qty > 0 and qty <> 'NaN'),
  CONSTRAINT "site_material_receipts_contract_pair" CHECK (num_nonnulls(contract_id, contract_line_id) in (0, 2)),
  CONSTRAINT "site_material_receipts_text_length" CHECK (char_length(supplier) <= 120 and char_length(note) <= 300),
  CONSTRAINT "site_material_receipts_void_pair" CHECK ((voided_at is null) = (voided_by is null))
);
CREATE INDEX "site_material_receipts_org_visit_idx" ON "site_material_receipts" USING btree ("org_id", "visit_id");
CREATE INDEX "site_material_receipts_org_contract_line_idx" ON "site_material_receipts" USING btree ("org_id", "contract_id", "contract_line_id") WHERE contract_line_id is not null;
CREATE INDEX "site_material_receipts_photo_idx" ON "site_material_receipts" USING btree ("org_id", "photo_id") WHERE photo_id is not null;

CREATE TABLE "site_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "project_id" uuid NOT NULL,
  "visit_id" uuid NOT NULL,
  "client_key" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "kind" "site_note_kind" NOT NULL,
  "body" text NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  CONSTRAINT "site_notes_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "site_notes_org_client_key_unique" UNIQUE ("org_id", "client_key"),
  CONSTRAINT "site_notes_body_present" CHECK (public.text_has_visible_character(body) and char_length(body) <= 2000),
  CONSTRAINT "site_notes_void_pair" CHECK ((voided_at is null) = (voided_by is null))
);
CREATE INDEX "site_notes_org_visit_idx" ON "site_notes" USING btree ("org_id", "visit_id");

-- Closed from birth (S2 security S5): RLS on, and forced, before the batch
-- commits. No policy exists yet, so even the role that will hold the grants
-- sees and writes no row here until apply-rls has written the policies.
ALTER TABLE "project_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_location_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_location_consents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_visits" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_photos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_photos" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_material_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_material_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "site_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_notes" FORCE ROW LEVEL SECURITY;

-- Foreign keys, after every table exists. org_id -> organizations RESTRICT on
-- each (the orgScoped convention), then the same-org, same-project and
-- same-contract edges. Every edge into a diary parent is RESTRICT, but for a
-- material's optional photo: a diary row is evidence and never disappears with
-- its parent.
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_project_same_org_fk"
  FOREIGN KEY ("org_id", "project_id") REFERENCES "public"."projects"("org_id", "id") ON DELETE RESTRICT;

ALTER TABLE "site_location_consents" ADD CONSTRAINT "site_location_consents_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;

ALTER TABLE "site_devices" ADD CONSTRAINT "site_devices_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;

ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_project_same_org_fk"
  FOREIGN KEY ("org_id", "project_id") REFERENCES "public"."projects"("org_id", "id") ON DELETE RESTRICT;

ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_visit_same_project_fk"
  FOREIGN KEY ("org_id", "project_id", "visit_id") REFERENCES "public"."site_visits"("org_id", "project_id", "id") ON DELETE RESTRICT;

ALTER TABLE "site_material_receipts" ADD CONSTRAINT "site_material_receipts_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "site_material_receipts" ADD CONSTRAINT "site_material_receipts_visit_same_project_fk"
  FOREIGN KEY ("org_id", "project_id", "visit_id") REFERENCES "public"."site_visits"("org_id", "project_id", "id") ON DELETE RESTRICT;
ALTER TABLE "site_material_receipts" ADD CONSTRAINT "site_material_receipts_contract_same_project_fk"
  FOREIGN KEY ("org_id", "project_id", "contract_id") REFERENCES "public"."contracts"("org_id", "project_id", "id") ON DELETE RESTRICT;
ALTER TABLE "site_material_receipts" ADD CONSTRAINT "site_material_receipts_contractLine_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "contract_line_id") REFERENCES "public"."contract_lines"("org_id", "contract_id", "id") ON DELETE RESTRICT;
ALTER TABLE "site_material_receipts" ADD CONSTRAINT "site_material_receipts_photo_same_project_fk"
  FOREIGN KEY ("org_id", "project_id", "photo_id") REFERENCES "public"."site_photos"("org_id", "project_id", "id") ON DELETE SET NULL ("photo_id");

ALTER TABLE "site_notes" ADD CONSTRAINT "site_notes_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "site_notes" ADD CONSTRAINT "site_notes_visit_same_project_fk"
  FOREIGN KEY ("org_id", "project_id", "visit_id") REFERENCES "public"."site_visits"("org_id", "project_id", "id") ON DELETE RESTRICT;

-- THE STRAGGLER CHECK of 0052, again: after this file no composite foreign key
-- in `public` may carry an unqualified SET NULL, or name org_id in its column
-- list. A new set-null FK that slipped through bare refuses the whole batch.
DO $$
DECLARE
  stragglers integer;
BEGIN
  SELECT count(*) INTO stragglers
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public'
     AND c.contype = 'f'
     AND c.confdeltype = 'n'
     AND array_length(c.conkey, 1) > 1
     AND (
       coalesce(array_length(c.confdelsetcols, 1), 0) <> 1
       OR (
         SELECT a.attname
           FROM pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attnum = c.confdelsetcols[1]
       ) = 'org_id'
     );
  IF stragglers > 0 THEN
    RAISE EXCEPTION '0064: % composite set-null foreign key(s) still null every referencing column (org_id included)', stragglers;
  END IF;
END $$;
