-- rls/policies/35-execution.sql: Stage 2 execution (migration 0063), the six
-- execution tables of an execution contract.
--
-- One of the policies/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Every statement here is idempotent (`drop ... if exists` /
-- `alter table ... enable`). A table's triggers live in the SAME file as its
-- policies. rls/**.sql is exempt from the 150-line rule (stack-profile.md).
--
-- ORG ISOLATION, IN THE WRAPPED FORM. Each table gets the same `org_isolation`
-- policy as every other org table (org match AND the membership second
-- factor), both halves wrapped in `(select ...)` so they run ONCE per query as
-- an InitPlan (see policies/00-core.sql; policy-wrapped.test.ts pins it).
--
-- LOCKS. Each `alter table`, `drop trigger` and `create trigger` takes a
-- table lock for an instant. In DB step A every table here was new, so no
-- request waited for it; from DB step B on they hold live rows, and a run
-- waits at most the 3 s lock_timeout per table (six tables x 3 s is the worst
-- case) behind a long studio transaction, then rolls this file back whole
-- (apply-rls retries it, ../scripts/apply-rls-retry.ts).
--
-- WHAT GUARDS WHAT (beside the grants in roles.sql):
--   contract_payment_milestones  full DML while the contract is a draft;
--                                frozen with the contract by the existing
--                                enforce_contract_child_draft() (MT100)
--   payment_requests             trg_payment_requests_frozen: only issued ->
--                                void, never a delete (MT100); and (step B)
--                                trg_payment_requests_actor: issued_by and
--                                voided_by name the session user (MT140)
--   contract_payments            append-only BY GRANT (SELECT + INSERT), and
--                                trg_contract_payments_fits: only on an issued
--                                request, never past its amount (MT130/MT131);
--                                (step B) trg_contract_payments_actor:
--                                recorded_by is the session user (MT140)
--   contract_line_measurements   append-only BY GRANT (SELECT, and INSERT on
--                                every column but `seq`); (step B)
--                                trg_contract_line_measurements_actor:
--                                recorded_by is the session user (MT140), and
--                                trg_contract_line_measurements_guarded: a
--                                signed execution contract with no issued
--                                final account, a day from its issue to
--                                tomorrow, created_at = now() (MT100)
--   contract_payment_claims      written only by the client's delivery-link
--                                function; (step B) metra_app SELECT and
--                                UPDATE of the answer's columns only, and
--                                trg_contract_payment_claims_guarded: the
--                                client's evidence never changes, only
--                                pending -> confirmed | dismissed (MT100);
--                                trg_contract_payment_claims_actor:
--                                resolved_by is the session user (MT140)
--   contract_cost_entries        no DELETE grant, UPDATE on the entry fields
--                                and the void stamp only; (step B)
--                                trg_contract_cost_entries_guarded: never
--                                re-homed, un-voided or edited once voided
--                                (MT100), and trg_contract_cost_entries_actor:
--                                recorded_by and voided_by are the session
--                                user (MT140)

-- contract_payment_milestones
alter table public.contract_payment_milestones enable row level security;
alter table public.contract_payment_milestones force  row level security;
drop policy if exists org_isolation on public.contract_payment_milestones;
create policy org_isolation on public.contract_payment_milestones
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- payment_requests
alter table public.payment_requests enable row level security;
alter table public.payment_requests force  row level security;
drop policy if exists org_isolation on public.payment_requests;
create policy org_isolation on public.payment_requests
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- contract_payments (append-only via grants)
alter table public.contract_payments enable row level security;
alter table public.contract_payments force  row level security;
drop policy if exists org_isolation on public.contract_payments;
create policy org_isolation on public.contract_payments
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- contract_payment_claims
alter table public.contract_payment_claims enable row level security;
alter table public.contract_payment_claims force  row level security;
drop policy if exists org_isolation on public.contract_payment_claims;
create policy org_isolation on public.contract_payment_claims
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- contract_cost_entries
alter table public.contract_cost_entries enable row level security;
alter table public.contract_cost_entries force  row level security;
drop policy if exists org_isolation on public.contract_cost_entries;
create policy org_isolation on public.contract_cost_entries
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- contract_line_measurements (append-only via grants)
alter table public.contract_line_measurements enable row level security;
alter table public.contract_line_measurements force  row level security;
drop policy if exists org_isolation on public.contract_line_measurements;
create policy org_isolation on public.contract_line_measurements
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- The payment schedule is part of what the client signs: editable only while
-- the contract is a draft, by the same guard as the contract's own lines.
drop trigger if exists trg_contract_payment_milestones_parent_draft on public.contract_payment_milestones;
create trigger trg_contract_payment_milestones_parent_draft
  before insert or update or delete on public.contract_payment_milestones
  for each row
  execute function public.enforce_contract_child_draft();

-- A payment request is frozen once written: only issued -> void.
drop trigger if exists trg_payment_requests_frozen on public.payment_requests;
create trigger trg_payment_requests_frozen
  before update or delete on public.payment_requests
  for each row
  execute function public.enforce_payment_request_frozen();

-- A payment fits its request: issued, and within its amount, under the
-- request's row lock (functions/35-execution.sql).
drop trigger if exists trg_contract_payments_fits on public.contract_payments;
create trigger trg_contract_payments_fits
  before insert on public.contract_payments
  for each row
  execute function public.enforce_contract_payment_fits();

-- DB step B (B3 security S2): a cost entry keeps its contract, recorder, key
-- and creation time, and a voided one stays voided (functions/35-execution.sql).
drop trigger if exists trg_contract_cost_entries_guarded on public.contract_cost_entries;
create trigger trg_contract_cost_entries_guarded
  before update on public.contract_cost_entries
  for each row
  execute function public.enforce_cost_entry_guarded();

-- DB step B (A4 security S3): the actor a money write names is the session's
-- user, for metra_app. Named `..._actor` so each runs before its table's other
-- BEFORE trigger (they fire in name order), and an impersonating write is
-- refused before any lock is taken.
drop trigger if exists trg_payment_requests_actor on public.payment_requests;
create trigger trg_payment_requests_actor
  before insert or update on public.payment_requests
  for each row
  execute function public.enforce_actor_is_session_user('issued_by', 'voided_by');

drop trigger if exists trg_contract_payments_actor on public.contract_payments;
create trigger trg_contract_payments_actor
  before insert on public.contract_payments
  for each row
  execute function public.enforce_actor_is_session_user('recorded_by');

drop trigger if exists trg_contract_cost_entries_actor on public.contract_cost_entries;
create trigger trg_contract_cost_entries_actor
  before insert or update on public.contract_cost_entries
  for each row
  execute function public.enforce_actor_is_session_user('recorded_by', 'voided_by');

-- DB step B (B4 security S1): a client's claim keeps what the client sent, and
-- is answered once; the member who answers it is the session's user.
drop trigger if exists trg_contract_payment_claims_actor on public.contract_payment_claims;
create trigger trg_contract_payment_claims_actor
  before update on public.contract_payment_claims
  for each row
  execute function public.enforce_actor_is_session_user('resolved_by');

drop trigger if exists trg_contract_payment_claims_guarded on public.contract_payment_claims;
create trigger trg_contract_payment_claims_guarded
  before update on public.contract_payment_claims
  for each row
  execute function public.enforce_contract_payment_claim_guarded();

-- DB step B (A5 security S2): a site reading names the session's user, and goes
-- only on a signed execution contract that is still open, on a day it can have
-- been measured (functions/35-execution.sql).
drop trigger if exists trg_contract_line_measurements_actor on public.contract_line_measurements;
create trigger trg_contract_line_measurements_actor
  before insert on public.contract_line_measurements
  for each row
  execute function public.enforce_actor_is_session_user('recorded_by');

drop trigger if exists trg_contract_line_measurements_guarded on public.contract_line_measurements;
create trigger trg_contract_line_measurements_guarded
  before insert on public.contract_line_measurements
  for each row
  execute function public.enforce_contract_line_measurement_guarded();
