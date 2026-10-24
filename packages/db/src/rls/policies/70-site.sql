-- rls/policies/70-site.sql: Stage 3, the site diary (migration 0064), the
-- seven site tables.
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
-- Studio READS stay org-wide, as for every other table (plan A1).
--
-- THE ASSIGNMENT RULE, AS A SECOND FACTOR. The four diary tables a site
-- engineer writes (site_visits, site_photos, site_material_receipts,
-- site_notes) also carry a RESTRICTIVE insert policy, `site_write_assigned`:
-- restrictive policies AND with the permissive org_isolation, so an INSERT
-- must pass both. Its check, app_may_write_site_project(project_id)
-- (functions/80-site.sql), lets owner, admin and project_manager write on any
-- project of the org and a site_engineer only on a project with his LIVE
-- assignment; every other role writes nothing. It is per ROW (it takes the
-- row's project), so it is not wrapped, and it is FOR INSERT only: voids and
-- publication are studio decisions the cores gate by capability.
--
-- LOCKS. Every table here is new in 0064, so the ACCESS EXCLUSIVE each
-- `alter table`, `create policy` and `create trigger` takes is on a relation no
-- request is waiting for. Seven tables x the 3 s lock_timeout is the worst
-- case.
--
-- WHAT GUARDS WHAT (beside the grants in roles.sql, none of which is DELETE):
--   site_visits                trg_site_visits_guard: only the check-out
--                              (once), the publication and the coordinate
--                              purge (to null) may change (MT100)
--   site_photos                trg_site_photos_guard: only status,
--                              client_visible, caption and the void (once)
--   site_material_receipts,
--   site_notes                 trg_site_*_guard: only the void (once)
--   project_assignments,
--   site_location_consents,
--   site_devices               mutable lifecycle (revoke / withdraw stamps)

-- project_assignments
alter table public.project_assignments enable row level security;
alter table public.project_assignments force  row level security;
drop policy if exists org_isolation on public.project_assignments;
create policy org_isolation on public.project_assignments
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- site_location_consents
alter table public.site_location_consents enable row level security;
alter table public.site_location_consents force  row level security;
drop policy if exists org_isolation on public.site_location_consents;
create policy org_isolation on public.site_location_consents
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- site_devices
alter table public.site_devices enable row level security;
alter table public.site_devices force  row level security;
drop policy if exists org_isolation on public.site_devices;
create policy org_isolation on public.site_devices
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );

-- site_visits
alter table public.site_visits enable row level security;
alter table public.site_visits force  row level security;
drop policy if exists org_isolation on public.site_visits;
create policy org_isolation on public.site_visits
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );
drop policy if exists site_write_assigned on public.site_visits;
create policy site_write_assigned on public.site_visits
  as restrictive
  for insert
  with check (public.app_may_write_site_project(project_id));

-- site_photos
alter table public.site_photos enable row level security;
alter table public.site_photos force  row level security;
drop policy if exists org_isolation on public.site_photos;
create policy org_isolation on public.site_photos
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );
drop policy if exists site_write_assigned on public.site_photos;
create policy site_write_assigned on public.site_photos
  as restrictive
  for insert
  with check (public.app_may_write_site_project(project_id));

-- site_material_receipts
alter table public.site_material_receipts enable row level security;
alter table public.site_material_receipts force  row level security;
drop policy if exists org_isolation on public.site_material_receipts;
create policy org_isolation on public.site_material_receipts
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );
drop policy if exists site_write_assigned on public.site_material_receipts;
create policy site_write_assigned on public.site_material_receipts
  as restrictive
  for insert
  with check (public.app_may_write_site_project(project_id));

-- site_notes
alter table public.site_notes enable row level security;
alter table public.site_notes force  row level security;
drop policy if exists org_isolation on public.site_notes;
create policy org_isolation on public.site_notes
  using (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  )
  with check (
    org_id = (select nullif(current_setting('app.current_org_id', true), '')::uuid)
    and (select public.app_is_current_org_member())
  );
drop policy if exists site_write_assigned on public.site_notes;
create policy site_write_assigned on public.site_notes
  as restrictive
  for insert
  with check (public.app_may_write_site_project(project_id));

-- The evidence guards (functions/80-site.sql). The entry guard's arguments are
-- the ONLY columns an UPDATE may change on that table.
drop trigger if exists trg_site_visits_guard on public.site_visits;
create trigger trg_site_visits_guard
  before update or delete on public.site_visits
  for each row
  execute function public.enforce_site_visit_guard();

drop trigger if exists trg_site_photos_guard on public.site_photos;
create trigger trg_site_photos_guard
  before update or delete on public.site_photos
  for each row
  execute function public.enforce_site_entry_guard(
    'status', 'client_visible', 'caption', 'voided_at', 'voided_by', 'updated_at'
  );

drop trigger if exists trg_site_material_receipts_guard on public.site_material_receipts;
create trigger trg_site_material_receipts_guard
  before update or delete on public.site_material_receipts
  for each row
  execute function public.enforce_site_entry_guard('voided_at', 'voided_by', 'updated_at');

drop trigger if exists trg_site_notes_guard on public.site_notes;
create trigger trg_site_notes_guard
  before update or delete on public.site_notes
  for each row
  execute function public.enforce_site_entry_guard('voided_at', 'voided_by', 'updated_at');
