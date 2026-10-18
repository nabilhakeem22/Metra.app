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
-- LOCKS. Every table here is new in 0063, so the ACCESS EXCLUSIVE each
-- `alter table` and `create trigger` takes is on a relation no request is
-- waiting for. Six tables x the 3 s lock_timeout is the worst case.
--
-- WHAT GUARDS WHAT (beside the grants in roles.sql):
--   contract_payment_milestones  full DML while the contract is a draft;
--                                frozen with the contract by the existing
--                                enforce_contract_child_draft() (MT100)
--   payment_requests             trg_payment_requests_frozen: only issued ->
--                                void, never a delete (MT100)
--   contract_payments,
--   contract_line_measurements   append-only BY GRANT (SELECT + INSERT)
--   contract_payment_claims,
--   contract_cost_entries        mutable lifecycle, no DELETE grant

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
