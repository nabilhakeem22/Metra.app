-- 0060: Round E: the client page CHECKs of 0059 brought up to the rules the
-- app has applied since Round D Wave 3 (apps/web/src/lib/org/studio-phone.ts
-- and printable-text.ts).
-- SCHEMA ONLY: three CHECKs dropped and added again under the SAME names. No
-- column, no index, no backfill, no row touched, no policy, no grant, no
-- trigger and no apply-rls function referenced (those live in rls/ and are
-- applied by `db:apply-rls` AFTER this file; the same step drops the retired
-- six-argument app_delivery_respond_by_token there).
--
-- organizations_studio_phone_format, organizations_studio_whatsapp_format:
--   an international number may no longer start `+200` (Egypt's code with its
--   trunk 0 kept). Since Round D Wave 3 the app drops every trunk 0 after +20,
--   so "+20 00 10 1234 5678" is stored as `+201012345678`; 0059 still let
--   `+200...` through because the code before Wave 3 could store it. Every
--   other rule is unchanged.
-- organizations_payment_text_printable (instapay_address, bank_name,
--   bank_account_holder): ALSO refuses U+2028 and U+2029 (the line and
--   paragraph separators) anywhere in the value, as the app has since Wave 3,
--   and counts U+1D159 (the musical null notehead) as blank-looking: a value
--   made ONLY of it (and the other invisible characters 0059 lists) is
--   refused, and one with a visible character beside it is kept, exactly as
--   the app treats it. The same whole-value rule now also covers the
--   unassigned default-ignorable code points (U+FFF0 to U+FFF8, U+E0000,
--   U+E0002 to U+E001F, U+E0080 to U+E00FF, U+E01F0 to U+E0FFF), which the
--   app already refuses as a whole value.
--
-- LOOSER THAN THE APP, NEVER STRICTER. The app normalises every value before
-- it writes, so a value it accepts must pass every CHECK here, or a Settings
-- save would fail with 23514. The classes and patterns are built in ONE place,
-- packages/db/src/schema/organizations-checks.ts, and this file holds that
-- module's text verbatim (organizations-checks.test.ts compares them); the
-- invariant and the differential test over the app's normaliser are there and
-- in apps/web/tests/actions/delivery-db-step-0059-differential.dbtest.ts.
--
-- EXISTING ROWS. A read-only production count on Oct 12 2026 found no stored
-- `+200` phone or WhatsApp and no payment text holding U+2028, U+2029 or
-- U+1D159. If a row does violate a new rule, ADD CONSTRAINT fails with 23514
-- and the whole batch rolls back with every 0059 CHECK still in place; the
-- runbook (docs/DEPLOY.md, 0060) lists the violators BEFORE the migration and
-- says how to fix them.
--
-- LOCKS. Each DROP + ADD takes ACCESS EXCLUSIVE on `organizations` and scans it
-- once, and `db:migrate` runs the batch as ONE transaction, so the table is
-- closed to reads and writes from the first ALTER until the commit. Small at
-- pilot volume, well inside the migrator's 3 s lock_timeout, which the block
-- re-asserts so a long reader makes it fail fast with 55P03 instead of
-- queueing every writer behind it. That is an estimate, not a production
-- measurement. Re-runnable: DROP CONSTRAINT IF EXISTS, then ADD.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_studio_phone_format,
    ADD CONSTRAINT organizations_studio_phone_format
    CHECK (studio_phone IS NULL OR (studio_phone ~ '^\+[1-9][0-9]{7,14}$' AND studio_phone !~ '^\+200') OR studio_phone ~ '^0[1-9][0-9]{7,9}$');
  ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_studio_whatsapp_format,
    ADD CONSTRAINT organizations_studio_whatsapp_format
    CHECK (studio_whatsapp IS NULL OR (studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' AND studio_whatsapp !~ '^\+200') OR studio_whatsapp ~ '^01[0125][0-9]{8}$');
  ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_payment_text_printable,
    ADD CONSTRAINT organizations_payment_text_printable
    CHECK ((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F\u2028\u2029]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\U0001D159\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF\uFFF0-\uFFF8\U000E0000\U000E0002-\U000E001F\U000E0080-\U000E00FF\U000E01F0-\U000E0FFF]')));
END $$;
