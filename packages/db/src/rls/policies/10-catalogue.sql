-- rls/policies/10-catalogue.sql — the catalogue: sections, cost items, price changes, clients, projects, stages.
--
-- One of the policies/* files apply-rls runs LAST, in the order
-- rls/manifest.ts declares. Every statement here is idempotent
-- (`drop ... if exists` / `create or replace` / `alter table ... enable`).
-- A table's triggers live in the SAME file as its policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- sections (per-tenant work sections; shared by Price Book + proposal builder)
alter table public.sections enable row level security;
alter table public.sections force  row level security;
drop policy if exists org_isolation on public.sections;
create policy org_isolation on public.sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- cost_items (P1 Price Book)
alter table public.cost_items enable row level security;
alter table public.cost_items force  row level security;
drop policy if exists org_isolation on public.cost_items;
create policy org_isolation on public.cost_items
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- price_changes (append-only via grants; still org-isolated + membership-gated)
alter table public.price_changes enable row level security;
alter table public.price_changes force  row level security;
drop policy if exists org_isolation on public.price_changes;
create policy org_isolation on public.price_changes
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- price_change_lines (append-only via grants; org-isolated + membership-gated)
alter table public.price_change_lines enable row level security;
alter table public.price_change_lines force  row level security;
drop policy if exists org_isolation on public.price_change_lines;
create policy org_isolation on public.price_change_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- clients (P1 Slice 2)
alter table public.clients enable row level security;
alter table public.clients force  row level security;
drop policy if exists org_isolation on public.clients;
create policy org_isolation on public.clients
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- client_contacts (P1 Slice 4)
alter table public.client_contacts enable row level security;
alter table public.client_contacts force  row level security;
drop policy if exists org_isolation on public.client_contacts;
create policy org_isolation on public.client_contacts
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- activities (P1 Slice 4; polymorphic feed)
alter table public.activities enable row level security;
alter table public.activities force  row level security;
drop policy if exists org_isolation on public.activities;
create policy org_isolation on public.activities
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- projects (P1 Slice 2)
alter table public.projects enable row level security;
alter table public.projects force  row level security;
drop policy if exists org_isolation on public.projects;
create policy org_isolation on public.projects
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- project_types (P1 Slice 5; editable classifications)
alter table public.project_types enable row level security;
alter table public.project_types force  row level security;
drop policy if exists org_isolation on public.project_types;
create policy org_isolation on public.project_types
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- stage_templates (P1 Slice 5; org-wide stage process)
alter table public.stage_templates enable row level security;
alter table public.stage_templates force  row level security;
drop policy if exists org_isolation on public.stage_templates;
create policy org_isolation on public.stage_templates
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- project_stages (P1 Slice 5; per-project stages)
alter table public.project_stages enable row level security;
alter table public.project_stages force  row level security;
drop policy if exists org_isolation on public.project_stages;
create policy org_isolation on public.project_stages
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );
