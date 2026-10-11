-- 0059: Round D, PR-D2: the client page CHECKs of 0058 tightened to the rules
-- the app has applied since Round C's Settings card shipped
-- (apps/web/src/lib/org/client-page-details.ts).
-- SCHEMA ONLY: three CHECKs dropped and added again under the SAME names. No
-- column, no index, no backfill, no row touched, no policy, no grant, no
-- trigger and no apply-rls function referenced (those live in rls/ and are
-- applied by `db:apply-rls` AFTER this file).
--
-- organizations_studio_phone_format, organizations_studio_whatsapp_format:
--   0058 allowed digits with an optional `+`, 7 to 15 of them. Now a number
--   is `+` and the international digits (a country code that does not start
--   with 0, 8 to 15 digits in all) or an Egyptian number with its trunk 0: any
--   national number for the phone (a mobile or a landline), only a mobile for
--   WhatsApp (wa.me cannot open a landline).
-- organizations_payment_text_printable (instapay_address, bank_name,
--   bank_account_holder): 0058 refused a format character and a value of white
--   space only. Now it ALSO refuses a C0 or C1 control character (anywhere in
--   the value), and a value made ONLY of these: white space, NEL, the Braille
--   blank, the Hangul fillers, the combining marks of the listed scripts
--   (Latin, Cyrillic, Arabic and the generic combining blocks), the Khmer
--   inherent vowels, the Mongolian and the other variation selectors, the
--   Egyptian hieroglyph mirror, the Khitan filler, private-use characters and
--   noncharacters. It is a list, not every invisible character Unicode has:
--   a mark of another script on its own still passes here (the app refuses
--   it). U+2028 and U+2029 (line and paragraph separators) are NOT refused in
--   this step: the app refuses them first, then a later CHECK.
--
-- LOOSER THAN THE APP, NEVER STRICTER. The app normalises every value before
-- it writes, so a value it accepts must pass every CHECK here, or a Settings
-- save would fail with 23514. The classes and patterns are built in ONE place,
-- packages/db/src/schema/organizations-checks.ts, and this file holds that
-- module's text verbatim (organizations-checks.test.ts compares them); the
-- invariant and the differential test over the app's normaliser are there and
-- in apps/web/tests/actions/delivery-db-step-0059-checks.dbtest.ts.
--
-- EXISTING ROWS. The seven columns became writable only through that Settings
-- card, which shipped with the strict normaliser, so no row should violate the
-- new rules. If one does, ADD CONSTRAINT fails with 23514 and the whole batch
-- rolls back with every 0058 CHECK still in place; the runbook (docs/DEPLOY.md,
-- 0059) counts the violators BEFORE the migration and says how to fix them.
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
    CHECK (studio_phone IS NULL OR studio_phone ~ '^\+[1-9][0-9]{7,14}$' OR studio_phone ~ '^0[1-9][0-9]{7,9}$');
  ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_studio_whatsapp_format,
    ADD CONSTRAINT organizations_studio_whatsapp_format
    CHECK (studio_whatsapp IS NULL OR studio_whatsapp ~ '^\+[1-9][0-9]{7,14}$' OR studio_whatsapp ~ '^01[0125][0-9]{8}$');
  ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_payment_text_printable,
    ADD CONSTRAINT organizations_payment_text_printable
    CHECK ((instapay_address IS NULL OR (instapay_address !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND instapay_address !~ '[\u0001-\u001F\u007F-\u009F]' AND instapay_address ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_name IS NULL OR (bank_name !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_name !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_name ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')) AND (bank_account_holder IS NULL OR (bank_account_holder !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]' AND bank_account_holder !~ '[\u0001-\u001F\u007F-\u009F]' AND bank_account_holder ~ '[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u2800\u115F\u1160\u3164\uFFA0\u0300-\u036F\u0483-\u0489\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED\u1AB0-\u1ACE\u1DC0-\u1DFF\u20D0-\u20F0\uFE20-\uFE2F\u17B4-\u17B5\u180B-\u180F\uFE00-\uFE0F\U00013440\U00016FE4\U000E0100-\U000E01EF\uE000-\uF8FF\uFDD0-\uFDEF\uFFFE-\uFFFF\U0001FFFE-\U0001FFFF\U0002FFFE-\U0002FFFF\U0003FFFE-\U0003FFFF\U0004FFFE-\U0004FFFF\U0005FFFE-\U0005FFFF\U0006FFFE-\U0006FFFF\U0007FFFE-\U0007FFFF\U0008FFFE-\U0008FFFF\U0009FFFE-\U0009FFFF\U000AFFFE-\U000AFFFF\U000BFFFE-\U000BFFFF\U000CFFFE-\U000CFFFF\U000DFFFE-\U000DFFFF\U000EFFFE-\U000EFFFF\U000F0000-\U0010FFFF]')));
END $$;
