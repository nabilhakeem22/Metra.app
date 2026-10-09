-- 0058: Round C, PR-C7: what the client page shows about the studio, and when
-- the client should expect the next step.
-- SCHEMA ONLY: ten nullable columns, nine CHECKs and one index. Additive and
-- idempotent; no backfill, no data touched, no enum label added, no table, no
-- policy, no grant, no trigger and no apply-rls function referenced (those live
-- in rls/ and are applied by `db:apply-rls` AFTER this file).
--
-- organizations (the studio, edited by owner/admin in Settings; the apply-rls
-- trigger trg_organizations_client_page_writer refuses anyone else):
--   studio_phone, studio_whatsapp   the numbers the client page offers as Call
--     and WhatsApp buttons. Digits only, an optional leading +, 7 to 15 digits
--     (the E.164 ceiling); the app normalises spaces, dashes and Arabic-Indic
--     digits away before it writes.
--   instapay_address, bank_name, bank_account_holder, bank_account_number,
--   bank_iban   the studio's payment instructions. The client page shows them
--     ONLY while a payment is due on a delivery that is still running, and
--     only when they name a usable method (app_delivery_by_token). An account
--     number or an IBAN without a bank name is refused: a client cannot pay
--     into an account they cannot name to their own bank. An account number
--     needs at least one digit. The three free-text fields need one visible
--     character and may hold no Unicode format character (category Cf: the
--     zero-width and bidirectional controls that make a copied name read
--     differently from what is stored); the classes are spelled out code
--     point by code point so the rule does not depend on the database locale.
--
-- design_engagements (one delivery):
--   client_expected_on, client_expected_state, client_expected_set_at   the
--     date the studio tells the client to expect the next step, the stage it
--     was set in, and when it was set. All three set or all three empty
--     (CHECK). The client page shows the date only while the delivery is still
--     in that stage AND no state move has been recorded since it was set (so a
--     revision loop back into the same stage does not bring it back) AND it is
--     today or later in Cairo.
--
-- notifications_org_entity_idx: the "was this act ever notified?" checks (the
--   repeat-tap repair and the hourly sweep) look up one delivery's
--   notifications by (org_id, entity_id). Without it they scanned every recent
--   notification of the org once per act. NOT built CONCURRENTLY: the migrator
--   runs the batch in ONE transaction, where CONCURRENTLY is refused (25001).
--
-- Every existing row passes every CHECK: all ten columns are new and NULL.
--
-- LOCKS. Each ADD COLUMN is metadata-only (nullable, no default) but takes
-- ACCESS EXCLUSIVE on its table, and `db:migrate` runs the batch as ONE
-- transaction, so `organizations` (from block 1) and `design_engagements` (from
-- block 2) are closed to reads and writes until the batch commits; inside that
-- window each CHECK scans its table once (eight scans of organizations, one of
-- design_engagements). Block 3 takes SHARE on `notifications` for the index
-- build: new notifications and mark-as-read wait, reads continue. All three
-- tables are small at pilot volume, so the file is well inside the migrator's
-- 3 s lock_timeout, which each block re-asserts so a long reader makes it fail
-- fast with 55P03 instead of queueing every writer behind it. That is an
-- estimate, not a production measurement. Re-runnable: every column and the
-- index are IF NOT EXISTS and every CHECK is guarded by pg_constraint.
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
      CHECK (bank_account_number IS NULL OR (bank_account_number ~ '^[0-9A-Za-z-]{4,34}$' AND bank_account_number ~ '[0-9]'));
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_payment_text_printable'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_payment_text_printable
      CHECK ((instapay_address IS NULL OR (instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_name IS NULL OR (bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')) AND (bank_account_holder IS NULL OR (bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]' AND bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]')));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.design_engagements ADD COLUMN IF NOT EXISTS client_expected_on date;
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS client_expected_state public.design_engagement_state;
  ALTER TABLE public.design_engagements
    ADD COLUMN IF NOT EXISTS client_expected_set_at timestamp with time zone;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'design_engagements_client_expected_together'
  ) THEN
    ALTER TABLE public.design_engagements
      ADD CONSTRAINT design_engagements_client_expected_together
      CHECK ((client_expected_on IS NULL) = (client_expected_state IS NULL) AND (client_expected_on IS NULL) = (client_expected_set_at IS NULL));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  CREATE INDEX IF NOT EXISTS notifications_org_entity_idx
    ON public.notifications (org_id, entity_id);
END $$;
