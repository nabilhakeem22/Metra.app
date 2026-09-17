-- rls/policies/30-contracts-boqs-variations.sql — contracts, BOQs and variation orders.
--
-- One of the policies/* files apply-rls runs LAST, in the order
-- rls/manifest.ts declares. Every statement here is idempotent
-- (`drop ... if exists` / `create or replace` / `alter table ... enable`).
-- A table's triggers live in the SAME file as its policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- P1 Slice 4 — Contracts + Variation Orders (org isolation for all 7 tables;
-- append-only event tables; status-immutable contracts + VOs; child-draft guards)
-- =============================================================================

-- contracts
alter table public.contracts enable row level security;
alter table public.contracts force  row level security;
drop policy if exists org_isolation on public.contracts;
create policy org_isolation on public.contracts
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_sections
alter table public.contract_sections enable row level security;
alter table public.contract_sections force  row level security;
drop policy if exists org_isolation on public.contract_sections;
create policy org_isolation on public.contract_sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_lines
alter table public.contract_lines enable row level security;
alter table public.contract_lines force  row level security;
drop policy if exists org_isolation on public.contract_lines;
create policy org_isolation on public.contract_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- boqs
alter table public.boqs enable row level security;
alter table public.boqs force  row level security;
drop policy if exists org_isolation on public.boqs;
create policy org_isolation on public.boqs
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- boq_sections
alter table public.boq_sections enable row level security;
alter table public.boq_sections force  row level security;
drop policy if exists org_isolation on public.boq_sections;
create policy org_isolation on public.boq_sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- boq_lines
alter table public.boq_lines enable row level security;
alter table public.boq_lines force  row level security;
drop policy if exists org_isolation on public.boq_lines;
create policy org_isolation on public.boq_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_events (append-only via grants; org-isolated + membership-gated)
alter table public.contract_events enable row level security;
alter table public.contract_events force  row level security;
drop policy if exists org_isolation on public.contract_events;
create policy org_isolation on public.contract_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_orders
alter table public.variation_orders enable row level security;
alter table public.variation_orders force  row level security;
drop policy if exists org_isolation on public.variation_orders;
create policy org_isolation on public.variation_orders
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_order_lines
alter table public.variation_order_lines enable row level security;
alter table public.variation_order_lines force  row level security;
drop policy if exists org_isolation on public.variation_order_lines;
create policy org_isolation on public.variation_order_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_order_events (append-only via grants; org-isolated + membership-gated)
alter table public.variation_order_events enable row level security;
alter table public.variation_order_events force  row level security;
drop policy if exists org_isolation on public.variation_order_events;
create policy org_isolation on public.variation_order_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- Contracts are frozen once they leave 'draft' (A1): only a whitelisted status
-- transition (issued->signed, issued|signed->terminated) may change the row.
drop trigger if exists trg_contracts_immutable on public.contracts;
create trigger trg_contracts_immutable
  before update or delete on public.contracts
  for each row
  execute function public.enforce_immutable_when(
    'status',
    'issued,signed,terminated',
    'signed,terminated'
  );

-- Contract sections + lines can only be mutated while the parent contract is 'draft'.
drop trigger if exists trg_contract_sections_parent_draft on public.contract_sections;
create trigger trg_contract_sections_parent_draft
  before insert or update or delete on public.contract_sections
  for each row
  execute function public.enforce_contract_child_draft();

drop trigger if exists trg_contract_lines_parent_draft on public.contract_lines;
create trigger trg_contract_lines_parent_draft
  before insert or update or delete on public.contract_lines
  for each row
  execute function public.enforce_contract_child_draft();

-- Variation orders are frozen once they leave 'draft' (A2): only a whitelisted
-- status transition (internal_approved->issued, issued->approved|rejected) allowed.
drop trigger if exists trg_variation_orders_immutable on public.variation_orders;
create trigger trg_variation_orders_immutable
  before update or delete on public.variation_orders
  for each row
  execute function public.enforce_immutable_when(
    'status',
    'internal_approved,issued,approved,rejected',
    'issued,approved,rejected'
  );

-- Variation order lines can only be mutated while the parent VO is 'draft'.
drop trigger if exists trg_variation_order_lines_parent_draft on public.variation_order_lines;
create trigger trg_variation_order_lines_parent_draft
  before insert or update or delete on public.variation_order_lines
  for each row
  execute function public.enforce_variation_child_draft();
