-- rls/policies/36-client-home.sql: client home DB step C (migration 0065), the
-- client's one-time codes.
--
-- One of the policies/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Every statement here is idempotent (`drop ... if exists` /
-- `alter table ... enable`). A table's triggers live in the SAME file as its
-- policies. rls/**.sql is exempt from the 150-line rule (stack-profile.md).
--
-- ORG ISOLATION, IN THE WRAPPED FORM, as every other org table (org match AND
-- the membership second factor, each half wrapped in `(select ...)` so it runs
-- once per query; policy-wrapped.test.ts pins it). metra_app holds SELECT on
-- every column but code_hash and no write at all (roles.sql): only the client
-- home's definer functions (functions/75-client-home.sql) write a code.
--
-- LOCKS. The table is new in 0065 and only the client's code requests write
-- it, so each statement's instant table lock waits on nothing in practice
-- (at most the 3 s lock_timeout behind a client act in flight).

alter table public.client_verification_codes enable row level security;
alter table public.client_verification_codes force  row level security;
drop policy if exists org_isolation on public.client_verification_codes;
create policy org_isolation on public.client_verification_codes
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- A code changes only by one wrong try or its one consumption, and is deleted
-- only with its delivery, or, never used, 90 days after it expired
-- (functions/75-client-home.sql).
drop trigger if exists trg_client_verification_codes_guarded on public.client_verification_codes;
create trigger trg_client_verification_codes_guarded
  before update or delete on public.client_verification_codes
  for each row
  execute function public.enforce_client_code_guarded();
