-- rls/policies/70-site.sql: Stage 3, the site diary (migration 0064), the
-- seven site tables.
--
-- One of the policies/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Every statement here is idempotent (`drop ... if exists` /
-- `alter table ... enable`). A table's triggers live in the SAME file as its
-- policies (the site pin guard on projects is in policies/10-catalogue.sql,
-- beside projects' own). rls/**.sql is exempt from the 150-line rule
-- (stack-profile.md).
--
-- ORG ISOLATION, IN THE WRAPPED FORM. Each table gets the same `org_isolation`
-- policy as every other org table (org match AND the membership second
-- factor), both halves wrapped in `(select ...)` so they run ONCE per query as
-- an InitPlan (see policies/00-core.sql; policy-wrapped.test.ts pins it).
-- Studio READS stay org-wide, as for every other table (plan A1). 0064 itself
-- enables and forces RLS on the seven (S2 security S5); the same two
-- statements here are idempotent and converge a hand-made drift.
--
-- WHO WRITES, AS A SECOND FACTOR. RESTRICTIVE policies AND with the permissive
-- org_isolation, so a write must pass both. Each says who, at the database,
-- for a writer that skips the core's own check:
--   site_visits, site_photos,  `site_write_assigned` (INSERT): the gate
--   site_material_receipts,    app_may_write_site_project(project_id) passes
--   site_notes                 (owner, admin and project_manager on any
--                              project, a site_engineer only with a LIVE
--                              assignment), AND the row's author column
--                              (user_id, uploaded_by, recorded_by, author_id)
--                              is the current user (S2 security S3).
--                              `site_update_assigned` (UPDATE): the same gate
--                              (S2 security S2); viewers, accountants, the
--                              client role and an unassigned or revoked
--                              engineer update nothing.
--   project_assignments        `site_managers_insert` / `site_managers_update`:
--                              only a manager assigns or revokes
--                              (app_may_manage_site_project), and `assigned_by`
--                              is the current user (S2 security S1).
--   site_location_consents     `site_consent_self_insert` / `_update`: a
--                              consent is recorded or withdrawn only by the
--                              person it is about (PDPL; S2 security S1).
-- The write gate takes the row's project, so it is per ROW and not wrapped;
-- the GUC comparisons and the no-argument manager gate are wrapped.
--
-- LOCKS. Every table here is new in 0064, so the ACCESS EXCLUSIVE each
-- `alter table`, `create policy` and `create trigger` takes is on a relation no
-- request is waiting for. Seven tables x the 3 s lock_timeout is the worst
-- case.
--
-- WHAT GUARDS WHAT (beside the grants in roles.sql, none of which is DELETE):
--   site_visits                trg_site_visits_guard: only the check-out
--                              (once), the publication (a manager's, stamped
--                              with the current user) and the coordinate
--                              purge (to null) may change (MT100);
--                              trg_site_visits_date: the visit's date is the
--                              Cairo day of its check-in
--   site_photos                trg_site_photos_guard: only status,
--                              client_visible, caption and the void (once,
--                              stamped with the current user; a voided photo
--                              is frozen whole); trg_site_photos_state: status
--                              only pending -> stored, and only a manager
--                              changes client_visible or caption
--   site_material_receipts,
--   site_notes                 trg_site_*_guard: only the void (once, stamped
--                              with the current user; then frozen whole)
--   project_assignments,
--   site_devices               trg_*_revoke_final: a revoke is final, stamped
--                              with the current user
--   site_location_consents     mutable lifecycle (the withdraw stamp)

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

drop policy if exists site_managers_insert on public.project_assignments;
create policy site_managers_insert on public.project_assignments
  as restrictive
  for insert
  with check ((select public.app_may_manage_site_project()) and assigned_by = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_managers_update on public.project_assignments;
create policy site_managers_update on public.project_assignments
  as restrictive
  for update
  using ((select public.app_may_manage_site_project()));

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

drop policy if exists site_consent_self_insert on public.site_location_consents;
create policy site_consent_self_insert on public.site_location_consents
  as restrictive
  for insert
  with check (user_id = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_consent_self_update on public.site_location_consents;
create policy site_consent_self_update on public.site_location_consents
  as restrictive
  for update
  using (user_id = (select nullif(current_setting('app.current_user_id', true), '')::uuid))
  with check (user_id = (select nullif(current_setting('app.current_user_id', true), '')::uuid));

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
  with check (public.app_may_write_site_project(project_id) and user_id = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_update_assigned on public.site_visits;
create policy site_update_assigned on public.site_visits
  as restrictive
  for update
  using (public.app_may_write_site_project(project_id));

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
  with check (public.app_may_write_site_project(project_id) and uploaded_by = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_update_assigned on public.site_photos;
create policy site_update_assigned on public.site_photos
  as restrictive
  for update
  using (public.app_may_write_site_project(project_id));

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
  with check (public.app_may_write_site_project(project_id) and recorded_by = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_update_assigned on public.site_material_receipts;
create policy site_update_assigned on public.site_material_receipts
  as restrictive
  for update
  using (public.app_may_write_site_project(project_id));

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
  with check (public.app_may_write_site_project(project_id) and author_id = (select nullif(current_setting('app.current_user_id', true), '')::uuid));
drop policy if exists site_update_assigned on public.site_notes;
create policy site_update_assigned on public.site_notes
  as restrictive
  for update
  using (public.app_may_write_site_project(project_id));

-- The guards (functions/80-site.sql). The entry guard's arguments are the
-- ONLY columns an UPDATE may change on that table.
drop trigger if exists trg_project_assignments_revoke_final on public.project_assignments;
create trigger trg_project_assignments_revoke_final
  before update on public.project_assignments
  for each row
  execute function public.enforce_site_revoke_final();

drop trigger if exists trg_site_devices_revoke_final on public.site_devices;
create trigger trg_site_devices_revoke_final
  before update on public.site_devices
  for each row
  execute function public.enforce_site_revoke_final();

drop trigger if exists trg_site_visits_guard on public.site_visits;
create trigger trg_site_visits_guard
  before update or delete on public.site_visits
  for each row
  execute function public.enforce_site_visit_guard();

drop trigger if exists trg_site_visits_date on public.site_visits;
create trigger trg_site_visits_date
  before insert on public.site_visits
  for each row
  execute function public.enforce_site_visit_date();

drop trigger if exists trg_site_photos_guard on public.site_photos;
create trigger trg_site_photos_guard
  before update or delete on public.site_photos
  for each row
  execute function public.enforce_site_entry_guard(
    'status', 'client_visible', 'caption', 'voided_at', 'voided_by', 'updated_at'
  );

drop trigger if exists trg_site_photos_state on public.site_photos;
create trigger trg_site_photos_state
  before update on public.site_photos
  for each row
  execute function public.enforce_site_photo_state();

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
