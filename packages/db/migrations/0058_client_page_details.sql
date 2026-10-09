-- 0058: Round C, PR-C7: what the client page shows about the studio, and when
-- the client should expect the next step.
-- SCHEMA ONLY: nine nullable columns and eight CHECKs. Additive and idempotent;
-- no backfill, no data touched, no enum label added, no table, no index, no
-- policy, no grant and no apply-rls function referenced (those live in rls/ and
-- are applied by `db:apply-rls` AFTER this file).
--
-- organizations (the studio, edited by owner/admin in Settings):
--   studio_phone, studio_whatsapp   the numbers the client page offers as Call
--     and WhatsApp buttons. Digits only, an optional leading +, 7 to 15 digits
--     (the E.164 ceiling); the app normalises spaces, dashes and Arabic-Indic
--     digits away before it writes.
--   instapay_address, bank_name, bank_account_holder, bank_account_number,
--   bank_iban   the studio's payment instructions. The client page shows them
--     ONLY while a payment is due (the read function returns them; the app's
--     mapper drops them unless a milestone is claimable). An account number or
--     an IBAN without a bank name is refused: a client cannot pay into an
--     account they cannot name to their own bank.
--
-- design_engagements (one delivery):
--   client_expected_on, client_expected_state   the date the studio tells the
--     client to expect the next step, and the stage it was set in. Set and
--     cleared as a pair (CHECK). The client page shows the date only while the
--     delivery is still in that stage, so a stage move retires it without any
--     write.
--
-- Every existing row passes every CHECK: all nine columns are new and NULL.
--
-- LOCKS. Each ADD COLUMN is metadata-only (nullable, no default) but takes
-- ACCESS EXCLUSIVE on its table, and `db:migrate` runs the batch as ONE
-- transaction, so `organizations` (from block 1) and `design_engagements` (from
-- block 2) are closed to reads and writes until the batch commits; inside that
-- window each CHECK scans its table once (seven scans of organizations, one of
-- design_engagements). Both tables are small at pilot volume, so the file is
-- well inside the migrator's 3 s lock_timeout, which each block re-asserts so a
-- long reader makes it fail fast with 55P03 instead of queueing every writer
-- behind it. That is an estimate, not a production measurement. Re-runnable:
-- every column is IF NOT EXISTS and every CHECK is guarded by pg_constraint.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS studio_phone text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS studio_whatsapp text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS instapay_address text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS bank_name text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS bank_account_holder text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS bank_account_number text;
  ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS bank_iban text;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_studio_phone_format'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_studio_phone_format
      CHECK (studio_phone IS NULL OR studio_phone ~ '^\+?[0-9]{7,15}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_studio_whatsapp_format'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_studio_whatsapp_format
      CHECK (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+?[0-9]{7,15}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_instapay_address_length'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_instapay_address_length
      CHECK (instapay_address IS NULL OR char_length(instapay_address) BETWEEN 3 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_bank_text_length'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_bank_text_length
      CHECK ((bank_name IS NULL OR char_length(bank_name) BETWEEN 2 AND 120) AND (bank_account_holder IS NULL OR char_length(bank_account_holder) BETWEEN 2 AND 120));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_bank_account_number_format'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_bank_account_number_format
      CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9A-Za-z-]{4,34}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_bank_iban_format'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_bank_iban_format
      CHECK (bank_iban IS NULL OR bank_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_bank_account_needs_bank'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_bank_account_needs_bank
      CHECK ((bank_account_number IS NULL AND bank_iban IS NULL) OR bank_name IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.design_engagements ADD COLUMN IF NOT EXISTS client_expected_on date;
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS client_expected_state public.design_engagement_state;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_engagements_client_expected_pair'
  ) THEN
    ALTER TABLE public.design_engagements
      ADD CONSTRAINT design_engagements_client_expected_pair
      CHECK ((client_expected_on IS NULL) = (client_expected_state IS NULL));
  END IF;
END $$;
