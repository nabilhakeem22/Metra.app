-- 0065: the client home (DB step C). SCHEMA ONLY and ADDITIVE: one column and
-- two CHECKs and one partial unique index on design_engagements, and one new
-- org-scoped table. No row is updated, nothing is backfilled, no policy, no
-- grant, no trigger and no apply-rls function is referenced (the policy, the
-- grants, the guard trigger and the functions live in rls/policies/
-- 36-client-home.sql, rls/roles.sql, rls/functions/65-execution-facts.sql and
-- rls/functions/75-client-home.sql, applied by `db:apply-rls` AFTER this file).
--
-- WHAT IT ADDS.
--   * design_engagements.entry_phase: the phase a delivery began in, 'design'
--     (every delivery so far, and the column default) or 'execution' (a LIGHT
--     delivery: the client home of a BOQ contract no design delivery stands
--     behind, born at `execution`). A constant default is catalogue only: no
--     row is rewritten.
--     - design_engagements_entry_phase_known: the two values only;
--     - design_engagements_light_is_execution: a light delivery is at
--       `execution`, and stays there (the design machine never runs on it);
--     - design_engagements_one_light_per_project_client: at most one light
--       delivery per project and client (a project's client can change, and
--       each client keeps its own page), the arbiter a concurrent second
--       create meets (23505).
--   * client_verification_codes: one row per one-time code a client asked for,
--     bound to (delivery, purpose, target). It stores the code's HASH only
--     (sha256 of `challengeId:code`, made by the app), the hash and a hint of
--     the address it went to, the caller's ip and user agent, when it was used
--     and what it was used for (result_ref). Ten minutes of life, five wrong
--     tries, by CHECK; the issue limits are the issue function's.
--   * RLS IS ENABLED AND FORCED on the new table HERE (the 0064 rule): with no
--     policy yet, metra_app reads nothing in it, so an apply-rls that stops half
--     way leaves it closed, never open.
--
-- THE CHECKS ON design_engagements go in NOT VALID and are then VALIDATEd, the
-- 0052 pattern: a violating row fails at VALIDATE with the constraint's name,
-- and the batch rolls back whole. Every existing row has entry_phase 'design'
-- (the default), so both hold.
--
-- LOCKS, ALL OR NONE (the 0064 pattern). `db:migrate` runs the batch as ONE
-- transaction. The first block takes EVERY lock this file needs on an EXISTING
-- table, ACCESS EXCLUSIVE on design_engagements (the column, the CHECKs and the
-- index) and SHARE ROW EXCLUSIVE on organizations (the new table's foreign
-- key), as ONE attempt of two `LOCK TABLE ... NOWAIT` inside a subtransaction.
-- An attempt that meets a busy table rolls back, which RELEASES the lock it
-- already took, sleeps 10 to 40 ms and tries again, within ONE 3 s budget in
-- all; a spent budget is 55P03 and the batch rolls back whole. So the
-- migration never holds design_engagements while it waits for organizations
-- (a studio save reads the membership, then writes the delivery). Then, held
-- to the commit:
--   design_engagements  one metadata-only ADD COLUMN, two CHECK validations
--                       (one scan each) and one partial unique index build.
-- The new table is created empty, so its foreign keys validate nothing. The
-- measured figures are in docs/DEPLOY.md (client home DB step C).
--
-- NAMES are the exact drizzle spellings; camelCase ones are DOUBLE-QUOTED so
-- Postgres keeps them (0053's header; migration-catalogue.test.ts).
DO $$
DECLARE
  lock_started constant timestamptz := clock_timestamp();
  lock_targets constant text[] := array[
    'public.design_engagements:ACCESS EXCLUSIVE',
    'public.organizations:SHARE ROW EXCLUSIVE'
  ];
  lock_target  text;
BEGIN
  -- EVERY LOCK, ALL OR NONE, within ONE 3 s budget for all the attempts
  -- together. The inner BEGIN ... EXCEPTION is a subtransaction: when one
  -- NOWAIT finds its table busy, the lock this attempt already took is
  -- released with it, so nothing is held between attempts.
  LOOP
    BEGIN
      FOREACH lock_target IN ARRAY lock_targets LOOP
        EXECUTE format('LOCK TABLE %s IN %s MODE NOWAIT', split_part(lock_target, ':', 1), split_part(lock_target, ':', 2));
      END LOOP;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF clock_timestamp() - lock_started >= interval '3 seconds' THEN
        RAISE EXCEPTION '0065: could not take every lock within 3 s (stopped at %)', lock_target
          USING ERRCODE = '55P03';
      END IF;
      PERFORM pg_sleep(0.01 + random() * 0.03);
    END;
  END LOOP;
  -- Every lock is held now; the statements below wait on nothing.

  ALTER TABLE public.design_engagements ADD COLUMN entry_phase text DEFAULT 'design' NOT NULL;
  ALTER TABLE public.design_engagements
    ADD CONSTRAINT design_engagements_entry_phase_known
    CHECK (entry_phase in ('design', 'execution')) NOT VALID;
  ALTER TABLE public.design_engagements VALIDATE CONSTRAINT design_engagements_entry_phase_known;
  ALTER TABLE public.design_engagements
    ADD CONSTRAINT design_engagements_light_is_execution
    CHECK (entry_phase = 'design' or state = 'execution') NOT VALID;
  ALTER TABLE public.design_engagements VALIDATE CONSTRAINT design_engagements_light_is_execution;
  CREATE UNIQUE INDEX design_engagements_one_light_per_project_client
    ON public.design_engagements USING btree (org_id, project_id, client_id) WHERE entry_phase = 'execution';
END $$;

CREATE TABLE "client_verification_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "engagement_id" uuid NOT NULL,
  "purpose" text NOT NULL,
  "target_key" text NOT NULL,
  "channel" text DEFAULT 'email' NOT NULL,
  "destination_hash" text NOT NULL,
  "destination_hint" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempts" smallint DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "result_ref" uuid,
  "actor_ip" text,
  "actor_user_agent" text,
  CONSTRAINT "client_verification_codes_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "client_verification_codes_purpose_known" CHECK (purpose in ('sign_contract', 'decide_variation', 'claim_request', 'claim_design_payment')),
  CONSTRAINT "client_verification_codes_target_key_length" CHECK (char_length(target_key) between 1 and 64),
  CONSTRAINT "client_verification_codes_channel_known" CHECK (channel in ('email')),
  CONSTRAINT "client_verification_codes_hashes_shape" CHECK (destination_hash ~ '^[0-9a-f]{64}$' and code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "client_verification_codes_hint_length" CHECK (char_length(destination_hint) between 1 and 80),
  CONSTRAINT "client_verification_codes_attempts_range" CHECK (attempts between 0 and 5),
  CONSTRAINT "client_verification_codes_life" CHECK (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT "client_verification_codes_consumed_pair" CHECK ((consumed_at is null) = (result_ref is null)),
  CONSTRAINT "client_verification_codes_actor_length" CHECK (char_length(actor_ip) <= 45 and char_length(actor_user_agent) <= 512)
);
CREATE INDEX "client_verification_codes_engagement_idx" ON "client_verification_codes" USING btree ("org_id", "engagement_id", "purpose", "target_key", "created_at" DESC);
CREATE INDEX "client_verification_codes_created_idx" ON "client_verification_codes" USING btree ("created_at");

-- Closed from birth (the 0064 rule): RLS on, and forced, before the batch
-- commits. No policy exists yet, so the role that will hold the grant sees no
-- row here until apply-rls has written the policy.
ALTER TABLE "client_verification_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_verification_codes" FORCE ROW LEVEL SECURITY;

-- Foreign keys: org_id -> organizations RESTRICT (the orgScoped convention),
-- and the delivery, same org, CASCADE: a code is evidence of the delivery's
-- client acts and goes with the delivery (the guard trigger admits a delete
-- only from that cascade, or 90 days after the code expired).
ALTER TABLE "client_verification_codes" ADD CONSTRAINT "client_verification_codes_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "client_verification_codes" ADD CONSTRAINT "client_verification_codes_engagement_same_org_fk"
  FOREIGN KEY ("org_id", "engagement_id") REFERENCES "public"."design_engagements"("org_id", "id") ON DELETE CASCADE;
