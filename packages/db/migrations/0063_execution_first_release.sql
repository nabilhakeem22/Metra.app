-- 0063: Stage 2, the execution first release (DB step A). SCHEMA ONLY and
-- ADDITIVE: three new enum types, six new org-scoped tables, four existing
-- tables altered. No row is updated, nothing is backfilled, no policy, no
-- grant, no trigger and no apply-rls function is referenced (RLS, grants and
-- the two triggers live in rls/functions/35-execution.sql,
-- rls/policies/35-execution.sql and rls/roles.sql, applied by `db:apply-rls`
-- AFTER this file; the /c and /v SQL is rls/functions/30-contracts-variations.sql).
--
-- WHAT IT ADDS.
--   * contracts: `source_proposal_id` may be NULL; new `source_boq_id` (the
--     issued BOQ an execution contract is generated from), its same-org FK
--     (RESTRICT), one contract per BOQ (`contracts_org_id_source_boq_unique`)
--     and `contracts_one_source`: EXACTLY one of the two sources is set. Every
--     existing row has a proposal and no BOQ, so the CHECK holds for all of them.
--   * contract_lines: `item_code` (null) and `provisional` (false) copied from a
--     BOQ line, unique (org_id, contract_id, id) for the 3-column FKs, and the
--     3-column FK (org_id, contract_id, section_id) -> contract_sections: a
--     line's section is a section of its own contract (NOT VALID, VALIDATE).
--   * contract_sections: unique (org_id, contract_id, id), same reason.
--   * variation_orders: `time_extension_days` (null, 0 to 3650), and unique
--     (org_id, contract_id, id) for the payment request's 3-column FK.
--   * contract_payment_milestones (the payment schedule the client signs),
--     payment_requests (frozen documents), contract_payments (append-only
--     ledger), contract_payment_claims (a client's "I paid"),
--     contract_cost_entries (actual costs, voidable) and
--     contract_line_measurements (append-only FINAL measured quantities at
--     handover; `seq`, an identity, orders the readings as recorded).
--   * 3-COLUMN FKs make "of THIS contract" a database fact: a cost entry's line
--     and section, a measurement's line, a payment's and a claim's request, and
--     a request's milestone and change order.
--
-- THE TWO SET NULL FKs ARE BORN NARROWED (the 0052 rule):
-- `contract_payment_claims_confirmedPayment_same_org_fk` and
-- `contract_cost_entries_costItem_same_org_fk` carry `ON DELETE SET NULL
-- (<column>)`, never the bare action that nulls org_id too. The straggler check
-- at the end of this file refuses the whole batch if any composite set-null FK
-- in `public` still lacks its column list.
--
-- THE CHECKS ON EXISTING TABLES go in NOT VALID and are then VALIDATEd, the
-- 0052 pattern. Inside ONE migrator transaction that does not shorten the lock
-- (the ACCESS EXCLUSIVE taken up front is held to the commit either
-- way); what it buys is that a violating row fails at VALIDATE
-- with the constraint's name, and the batch rolls back whole.
--
-- LOCKS. `db:migrate` runs the batch as ONE transaction. The first block takes
-- EVERY lock this file needs on an EXISTING table up front, in one fixed order,
-- inside ONE 3 s budget for all of them together (each LOCK TABLE gets what is
-- left of it as its lock_timeout): ACCESS EXCLUSIVE on contracts,
-- contract_sections, contract_lines and variation_orders, then SHARE ROW
-- EXCLUSIVE on boqs, cost_items and organizations (the new tables' FKs). So a
-- busy moment can hold the contract tables waiting for at most 3 s in total
-- before the batch gives up with 55P03 and rolls back, and nothing is acquired
-- late. Then, held to the commit:
--   contracts          DROP NOT NULL (a scan for nulls), a metadata-only ADD
--                      COLUMN, one unique index build, one CHECK validation;
--   contract_sections  one unique index build;
--   contract_lines     two metadata-only ADD COLUMNs (a constant default), one
--                      unique index build and the validation of the 3-column
--                      section FK, the biggest step (linear in contract lines);
--   variation_orders   a metadata-only ADD COLUMN, one CHECK scan of an
--                      all-NULL column, one unique index build.
-- The new tables are created empty, so their FKs validate nothing. The
-- measured figures are in docs/DEPLOY.md (0063).
--
-- ENUMS. Three CREATE TYPEs, used by the tables below in the same file: legal
-- (only `ALTER TYPE ... ADD VALUE` has the commit-before-use rule of 0061).
-- No statement names a label of an EXISTING enum.
--
-- NAMES are the exact drizzle spellings; camelCase ones are DOUBLE-QUOTED so
-- Postgres keeps them (0053's header; migration-catalogue.test.ts).
DO $$
DECLARE
  lock_started   timestamptz := clock_timestamp();
  lock_target    text;
  budget_left_ms integer;
BEGIN
  -- EVERY LOCK UP FRONT, in one fixed order, within ONE 3 s budget for all of
  -- them together (not 3 s each): the lock_timeout of each LOCK TABLE is what
  -- is left of the budget. So the contract tables are never held while this
  -- waits on a busy table behind them for more than 3 s in total, and nothing
  -- is acquired late (no lock-order deadlock with an app writer mid-batch).
  -- Out of budget = 55P03, and the whole batch rolls back.
  FOREACH lock_target IN ARRAY array[
    'public.contracts:ACCESS EXCLUSIVE',
    'public.contract_sections:ACCESS EXCLUSIVE',
    'public.contract_lines:ACCESS EXCLUSIVE',
    'public.variation_orders:ACCESS EXCLUSIVE',
    'public.boqs:SHARE ROW EXCLUSIVE',
    'public.cost_items:SHARE ROW EXCLUSIVE',
    'public.organizations:SHARE ROW EXCLUSIVE'
  ] LOOP
    budget_left_ms := 3000 - floor(extract(epoch from clock_timestamp() - lock_started) * 1000)::integer;
    IF budget_left_ms < 1 THEN
      RAISE EXCEPTION '0063: could not take every lock within 3 s (stopped at %)', lock_target
        USING ERRCODE = '55P03';
    END IF;
    PERFORM set_config('lock_timeout', budget_left_ms || 'ms', true);
    EXECUTE format('LOCK TABLE %s IN %s MODE', split_part(lock_target, ':', 1), split_part(lock_target, ':', 2));
  END LOOP;
  -- Every lock is held now; the statements below wait on nothing. The 3 s
  -- stays for the rest of the transaction (SET LOCAL semantics).
  PERFORM set_config('lock_timeout', '3s', true);

  ALTER TABLE public.contracts ALTER COLUMN source_proposal_id DROP NOT NULL;
  ALTER TABLE public.contracts ADD COLUMN source_boq_id uuid;
  ALTER TABLE public.contracts
    ADD CONSTRAINT contracts_org_id_source_boq_unique UNIQUE (org_id, source_boq_id);
  ALTER TABLE public.contracts
    ADD CONSTRAINT contracts_one_source
    CHECK (num_nonnulls(source_proposal_id, source_boq_id) = 1) NOT VALID;
  ALTER TABLE public.contracts VALIDATE CONSTRAINT contracts_one_source;
  ALTER TABLE public.contracts
    ADD CONSTRAINT "contracts_sourceBoq_same_org_fk"
    FOREIGN KEY (org_id, source_boq_id) REFERENCES public.boqs (org_id, id)
    ON DELETE RESTRICT NOT VALID;
  ALTER TABLE public.contracts VALIDATE CONSTRAINT "contracts_sourceBoq_same_org_fk";

  ALTER TABLE public.contract_sections
    ADD CONSTRAINT contract_sections_org_contract_id_unique UNIQUE (org_id, contract_id, id);

  ALTER TABLE public.contract_lines ADD COLUMN item_code text;
  ALTER TABLE public.contract_lines ADD COLUMN provisional boolean DEFAULT false NOT NULL;
  ALTER TABLE public.contract_lines
    ADD CONSTRAINT contract_lines_org_contract_id_unique UNIQUE (org_id, contract_id, id);
  -- A line's section is a section of ITS OWN contract (security review S3).
  -- Every existing line satisfies it: lines are written only by the contract
  -- copy, together with their section (runbook pre-flight 2 (e) counts any
  -- that do not, and VALIDATE would refuse the batch with 23503).
  ALTER TABLE public.contract_lines
    ADD CONSTRAINT contract_lines_section_same_contract_fk
    FOREIGN KEY (org_id, contract_id, section_id)
    REFERENCES public.contract_sections (org_id, contract_id, id)
    ON DELETE CASCADE NOT VALID;
  ALTER TABLE public.contract_lines VALIDATE CONSTRAINT contract_lines_section_same_contract_fk;

  ALTER TABLE public.variation_orders ADD COLUMN time_extension_days integer;
  ALTER TABLE public.variation_orders
    ADD CONSTRAINT variation_orders_time_extension_days_range
    CHECK (time_extension_days between 0 and 3650) NOT VALID;
  ALTER TABLE public.variation_orders VALIDATE CONSTRAINT variation_orders_time_extension_days_range;
  ALTER TABLE public.variation_orders
    ADD CONSTRAINT variation_orders_org_contract_id_unique UNIQUE (org_id, contract_id, id);
END $$;

CREATE TYPE "public"."payment_request_kind" AS ENUM ('milestone', 'variation', 'final_account');
CREATE TYPE "public"."payment_request_status" AS ENUM ('issued', 'void');
CREATE TYPE "public"."cost_category" AS ENUM ('materials', 'labour', 'subcontractor', 'equipment', 'transport', 'other');

CREATE TABLE "contract_payment_milestones" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "label_ar" text,
  "label_en" text,
  "basis" "milestone_basis" NOT NULL,
  "value" numeric(18, 4) NOT NULL,
  "sort_order" integer NOT NULL,
  CONSTRAINT "contract_payment_milestones_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "contract_payment_milestones_org_contract_id_unique" UNIQUE ("org_id", "contract_id", "id"),
  CONSTRAINT "contract_payment_milestones_org_contract_sort_unique" UNIQUE ("org_id", "contract_id", "sort_order"),
  CONSTRAINT "contract_payment_milestones_label_present" CHECK (length(regexp_replace(coalesce("label_ar", ''), '[[:space:]]', '', 'g')) > 0 or length(regexp_replace(coalesce("label_en", ''), '[[:space:]]', '', 'g')) > 0),
  CONSTRAINT "contract_payment_milestones_label_length" CHECK (coalesce(char_length(label_ar), 0) <= 80 and coalesce(char_length(label_en), 0) <= 80),
  CONSTRAINT "contract_payment_milestones_value_positive" CHECK (value > 0 and value <> 'NaN')
);

CREATE TABLE "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "number" integer NOT NULL,
  "kind" "payment_request_kind" NOT NULL,
  "milestone_id" uuid,
  "variation_order_id" uuid,
  "amount" numeric(18, 4) NOT NULL,
  "tax_amount" numeric(18, 4) NOT NULL,
  "issued_on" date NOT NULL,
  "due_on" date,
  "status" "payment_request_status" DEFAULT 'issued' NOT NULL,
  "note" text,
  "issued_by" uuid NOT NULL,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  CONSTRAINT "payment_requests_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "payment_requests_org_id_number_unique" UNIQUE ("org_id", "number"),
  CONSTRAINT "payment_requests_org_contract_id_unique" UNIQUE ("org_id", "contract_id", "id"),
  CONSTRAINT "payment_requests_amount_positive" CHECK (amount > 0 and amount <> 'NaN'),
  CONSTRAINT "payment_requests_tax_amount_range" CHECK (tax_amount >= 0 and tax_amount <= amount and tax_amount <> 'NaN'),
  CONSTRAINT "payment_requests_due_after_issue" CHECK (due_on >= issued_on),
  CONSTRAINT "payment_requests_note_length" CHECK (char_length(note) <= 500),
  CONSTRAINT "payment_requests_kind_target" CHECK (case kind::text
      when 'milestone' then milestone_id is not null and variation_order_id is null
      when 'variation' then variation_order_id is not null and milestone_id is null
      else milestone_id is null and variation_order_id is null end),
  CONSTRAINT "payment_requests_void_pair" CHECK ((status = 'void') = (voided_at is not null) and (voided_at is null) = (voided_by is null))
);
CREATE INDEX "payment_requests_org_contract_issued_idx" ON "payment_requests" USING btree ("org_id", "contract_id", "issued_on" DESC, "id" DESC);
CREATE UNIQUE INDEX "payment_requests_one_per_milestone" ON "payment_requests" USING btree ("org_id", "milestone_id") WHERE status = 'issued' and milestone_id is not null;
CREATE UNIQUE INDEX "payment_requests_one_per_variation" ON "payment_requests" USING btree ("org_id", "variation_order_id") WHERE status = 'issued' and variation_order_id is not null;
CREATE UNIQUE INDEX "payment_requests_one_final_account" ON "payment_requests" USING btree ("org_id", "contract_id") WHERE status = 'issued' and kind = 'final_account';

CREATE TABLE "contract_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "method" text,
  "reference" text,
  "received_on" date NOT NULL,
  "recorded_by" uuid NOT NULL,
  "note" text,
  "idempotency_key" text,
  CONSTRAINT "contract_payments_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "contract_payments_amount_positive" CHECK (amount > 0 and amount <> 'NaN'),
  CONSTRAINT "contract_payments_text_length" CHECK (char_length(method) <= 40 and char_length(reference) <= 120 and char_length(note) <= 500)
);
CREATE INDEX "contract_payments_org_request_idx" ON "contract_payments" USING btree ("org_id", "request_id");
CREATE INDEX "contract_payments_org_contract_received_idx" ON "contract_payments" USING btree ("org_id", "contract_id", "received_on" DESC, "id" DESC);
CREATE UNIQUE INDEX "contract_payments_idempotency_key_uniq" ON "contract_payments" USING btree ("org_id", "contract_id", "idempotency_key") WHERE idempotency_key is not null;

CREATE TABLE "contract_payment_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "claimed_amount" numeric(18, 4) NOT NULL,
  "note" text,
  "actor_name" text,
  "actor_ip" text,
  "actor_user_agent" text,
  "status" "client_payment_claim_status" DEFAULT 'pending' NOT NULL,
  "confirmed_payment_id" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "contract_payment_claims_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "contract_payment_claims_amount_positive" CHECK (claimed_amount > 0 and claimed_amount <> 'NaN'),
  CONSTRAINT "contract_payment_claims_resolution" CHECK (case status::text
      when 'pending'   then resolved_at is null and resolved_by is null and confirmed_payment_id is null
      when 'dismissed' then resolved_at is not null and resolved_by is not null and confirmed_payment_id is null
      when 'confirmed' then resolved_at is not null and confirmed_payment_id is not null
      else true end)
);
CREATE INDEX "contract_payment_claims_org_contract_status_idx" ON "contract_payment_claims" USING btree ("org_id", "contract_id", "status");
CREATE INDEX "contract_payment_claims_confirmedPayment_idx" ON "contract_payment_claims" USING btree ("org_id", "confirmed_payment_id");
CREATE UNIQUE INDEX "contract_payment_claims_pending_request_unique" ON "contract_payment_claims" USING btree ("org_id", "request_id") WHERE status = 'pending';

CREATE TABLE "contract_cost_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "contract_section_id" uuid,
  "contract_line_id" uuid,
  "cost_item_id" uuid,
  "category" "cost_category" NOT NULL,
  "description" text NOT NULL,
  "qty" numeric(18, 4),
  "unit" "cost_item_unit",
  "unit_cost" numeric(18, 4),
  "amount" numeric(18, 4) NOT NULL,
  "incurred_on" date NOT NULL,
  "supplier" text,
  "reference" text,
  "recorded_by" uuid NOT NULL,
  "idempotency_key" text,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  CONSTRAINT "contract_cost_entries_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "contract_cost_entries_description_present" CHECK (description ~ '[^[:space:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]' and char_length(description) <= 300),
  CONSTRAINT "contract_cost_entries_amount_positive" CHECK (amount > 0 and amount <> 'NaN'),
  CONSTRAINT "contract_cost_entries_qty_positive" CHECK (qty > 0 and qty <> 'NaN'),
  CONSTRAINT "contract_cost_entries_unit_cost_nonneg" CHECK (unit_cost >= 0 and unit_cost <> 'NaN'),
  CONSTRAINT "contract_cost_entries_quantity_triple" CHECK ((qty is null) = (unit is null) and (unit is null) = (unit_cost is null)),
  CONSTRAINT "contract_cost_entries_line_needs_section" CHECK (contract_line_id is null or contract_section_id is not null),
  CONSTRAINT "contract_cost_entries_text_length" CHECK (char_length(supplier) <= 120 and char_length(reference) <= 120),
  CONSTRAINT "contract_cost_entries_void_pair" CHECK ((voided_at is null) = (voided_by is null))
);
CREATE INDEX "contract_cost_entries_org_contract_incurred_idx" ON "contract_cost_entries" USING btree ("org_id", "contract_id", "incurred_on" DESC, "id" DESC);
CREATE INDEX "contract_cost_entries_org_line_idx" ON "contract_cost_entries" USING btree ("org_id", "contract_line_id") WHERE contract_line_id is not null;
CREATE INDEX "contract_cost_entries_costItem_idx" ON "contract_cost_entries" USING btree ("org_id", "cost_item_id");
CREATE UNIQUE INDEX "contract_cost_entries_idempotency_key_uniq" ON "contract_cost_entries" USING btree ("org_id", "contract_id", "idempotency_key") WHERE idempotency_key is not null;

CREATE TABLE "contract_line_measurements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "contract_id" uuid NOT NULL,
  "contract_line_id" uuid NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "measured_qty" numeric(18, 4) NOT NULL,
  "measured_on" date NOT NULL,
  "note" text,
  "recorded_by" uuid NOT NULL,
  "idempotency_key" text,
  CONSTRAINT "contract_line_measurements_org_id_id_unique" UNIQUE ("org_id", "id"),
  CONSTRAINT "contract_line_measurements_qty_nonneg" CHECK (measured_qty >= 0 and measured_qty <> 'NaN'),
  CONSTRAINT "contract_line_measurements_note_length" CHECK (char_length(note) <= 500)
);
CREATE INDEX "contract_line_measurements_org_line_latest_idx" ON "contract_line_measurements" USING btree ("org_id", "contract_line_id", "seq" DESC);
CREATE INDEX "contract_line_measurements_org_contract_idx" ON "contract_line_measurements" USING btree ("org_id", "contract_id");
CREATE UNIQUE INDEX "contract_line_measurements_idempotency_key_uniq" ON "contract_line_measurements" USING btree ("org_id", "contract_id", "idempotency_key") WHERE idempotency_key is not null;

-- Foreign keys, after every table exists. org_id -> organizations RESTRICT on
-- each (the orgScoped convention), then the same-org and same-contract edges.
ALTER TABLE "contract_payment_milestones" ADD CONSTRAINT "contract_payment_milestones_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_payment_milestones" ADD CONSTRAINT "contract_payment_milestones_contract_same_org_fk"
  FOREIGN KEY ("org_id", "contract_id") REFERENCES "public"."contracts"("org_id", "id") ON DELETE CASCADE;

ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_contract_same_org_fk"
  FOREIGN KEY ("org_id", "contract_id") REFERENCES "public"."contracts"("org_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_milestone_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "milestone_id") REFERENCES "public"."contract_payment_milestones"("org_id", "contract_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_variationOrder_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "variation_order_id") REFERENCES "public"."variation_orders"("org_id", "contract_id", "id") ON DELETE RESTRICT;

ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_payments" ADD CONSTRAINT "contract_payments_request_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "request_id") REFERENCES "public"."payment_requests"("org_id", "contract_id", "id") ON DELETE RESTRICT;

ALTER TABLE "contract_payment_claims" ADD CONSTRAINT "contract_payment_claims_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_payment_claims" ADD CONSTRAINT "contract_payment_claims_request_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "request_id") REFERENCES "public"."payment_requests"("org_id", "contract_id", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_payment_claims" ADD CONSTRAINT "contract_payment_claims_confirmedPayment_same_org_fk"
  FOREIGN KEY ("org_id", "confirmed_payment_id") REFERENCES "public"."contract_payments"("org_id", "id") ON DELETE SET NULL ("confirmed_payment_id");

ALTER TABLE "contract_cost_entries" ADD CONSTRAINT "contract_cost_entries_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_cost_entries" ADD CONSTRAINT "contract_cost_entries_contract_same_org_fk"
  FOREIGN KEY ("org_id", "contract_id") REFERENCES "public"."contracts"("org_id", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_cost_entries" ADD CONSTRAINT "contract_cost_entries_contractSection_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "contract_section_id") REFERENCES "public"."contract_sections"("org_id", "contract_id", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_cost_entries" ADD CONSTRAINT "contract_cost_entries_contractLine_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "contract_line_id") REFERENCES "public"."contract_lines"("org_id", "contract_id", "id") ON DELETE RESTRICT;
ALTER TABLE "contract_cost_entries" ADD CONSTRAINT "contract_cost_entries_costItem_same_org_fk"
  FOREIGN KEY ("org_id", "cost_item_id") REFERENCES "public"."cost_items"("org_id", "id") ON DELETE SET NULL ("cost_item_id");

ALTER TABLE "contract_line_measurements" ADD CONSTRAINT "contract_line_measurements_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;
ALTER TABLE "contract_line_measurements" ADD CONSTRAINT "contract_line_measurements_contractLine_same_contract_fk"
  FOREIGN KEY ("org_id", "contract_id", "contract_line_id") REFERENCES "public"."contract_lines"("org_id", "contract_id", "id") ON DELETE RESTRICT;

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
    RAISE EXCEPTION '0063: % composite set-null foreign key(s) still null every referencing column (org_id included)', stragglers;
  END IF;
END $$;
