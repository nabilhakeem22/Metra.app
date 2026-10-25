-- rls/functions/80-site.sql: Stage 3, the site diary (migration 0064): the two
-- gates the restrictive policies call (who may write on a project, who manages
-- it), the photo object key, and the guards on the site tables and the site pin.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Idempotent (`create or replace`). The triggers that use the guards
-- and the policies that use the gates are in rls/policies/70-site.sql, beside
-- the tables' org_isolation, and (for the site pin on projects) in
-- rls/policies/10-catalogue.sql, beside projects' own. rls/**.sql is exempt
-- from the 150-line rule (stack-profile.md).
--
-- WHO, AT THE DATABASE (S2 security S1 to S3). The cores gate by capability
-- first; these are the second factor, for a writer that skips the core's own
-- check. Every "who" check below applies to metra_app, the role every app
-- request runs as; the connection role (migrations, seeds, the fixture) is not
-- an app request and is not asked. "A manager" is owner, admin or
-- project_manager in the CURRENT org; "the current user" is
-- app.current_user_id. Every refusal is MT100.

-- May the session user WRITE diary rows on this project? True when the
-- caller's membership in the CURRENT org is owner, admin or project_manager,
-- or is site_engineer with a LIVE assignment on the project. Every other role
-- (accountant, viewer, client) and a revoked assignment answer false.
--
-- Called by the RESTRICTIVE `site_write_assigned` (insert) and
-- `site_update_assigned` (update) policies on site_visits, site_photos,
-- site_material_receipts and site_notes, so the assignment rule holds even for
-- a writer that skips the core's own check (AC5), and by the site pin guard.
--
-- SECURITY DEFINER so it reads memberships and project_assignments without
-- being filtered by the policies it supports (no recursion), and scoped to
-- exactly the GUCs of the request: it answers one yes or no about the caller
-- and can say nothing about anyone else. STABLE, `set search_path = ''`.
create or replace function public.app_may_write_site_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
     where m.org_id  = nullif(current_setting('app.current_org_id',  true), '')::uuid
       and m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
       and (
         m.role in ('owner', 'admin', 'project_manager')
         or (
           m.role = 'site_engineer'
           and exists (
             select 1
               from public.project_assignments a
              where a.org_id = m.org_id
                and a.project_id = p_project_id
                and a.user_id = m.user_id
                and a.revoked_at is null
           )
         )
       )
  );
$$;

-- Same-transaction lockdown (new-function-lockdown.test.ts): a NEW function is
-- executable by PUBLIC from the moment CREATE commits, and roles.sql runs
-- several files later. metra_app keeps EXECUTE: the policy runs as the caller.
revoke all on function public.app_may_write_site_project(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_may_write_site_project(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_may_write_site_project(uuid) to metra_app;
  end if;
end
$$;

-- Does the session user MANAGE the studio's sites? True when the caller's
-- membership in the CURRENT org is owner, admin or project_manager: the write
-- gate above without its site_engineer branch (S2 security S1). Called by the
-- restrictive policies on project_assignments (only a manager assigns or
-- revokes), by the visit and photo guards (only a manager changes what the
-- client sees) and by the site pin guard (a manager moves a pin). It takes no
-- project: every manager manages every project of the studio, as the write
-- gate already says.
--
-- SECURITY DEFINER for the same reason as the write gate, and scoped the same
-- way: one yes or no about the caller. STABLE, `set search_path = ''`.
create or replace function public.app_may_manage_site_project()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.memberships m
     where m.org_id  = nullif(current_setting('app.current_org_id',  true), '')::uuid
       and m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
       and m.role in ('owner', 'admin', 'project_manager')
  );
$$;

-- Same-transaction lockdown, as for the write gate.
revoke all on function public.app_may_manage_site_project() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_may_manage_site_project() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_may_manage_site_project() to metra_app;
  end if;
end
$$;

-- A site photo's object key (S2 reliability R1): `{org_id}/site/{project_id}/
-- {photo_id}-d.jpg` for the display copy, `-t.jpg` for the thumbnail. The key
-- is NOT STORED: it is this pure function of the row, so it can only point
-- inside the row's own studio and project, and costs the table no bytes. Its
-- TypeScript twin is apps/web/src/lib/site/photo-object-key.ts (the S5 photo
-- store presigns with it); site-photo-key.dbtest.ts holds the two to the same
-- string. A uuid's text is always lower-case.
--
-- IMMUTABLE and STRICT (a null id is a null key). Any variant but 'display'
-- and 'thumb' is a caller bug: 22023. NOT security definer.
create or replace function public.site_photo_object_key(
  p_org_id uuid,
  p_project_id uuid,
  p_photo_id uuid,
  p_variant text
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_variant not in ('display', 'thumb') then
    raise exception 'site_photo_object_key: the variant is display or thumb, not %', p_variant
      using errcode = '22023';
  end if;
  return p_org_id::text || '/site/' || p_project_id::text || '/' || p_photo_id::text
    || case p_variant when 'display' then '-d.jpg' else '-t.jpg' end;
end
$$;

-- Same-transaction lockdown: the client SDF calls it as its owner; metra_app
-- keeps EXECUTE for a studio read that names a key; nobody else.
revoke all on function public.site_photo_object_key(uuid, uuid, uuid, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.site_photo_object_key(uuid, uuid, uuid, text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.site_photo_object_key(uuid, uuid, uuid, text) to metra_app;
  end if;
end
$$;

-- A photo, a material delivery and a note are EVIDENCE: what was recorded
-- never changes. An UPDATE may change only the columns the trigger names in
-- its arguments (TG_ARGV), and once a row is voided NOTHING about it changes
-- any more, the void included (S2 functional F5). Every DELETE raises MT100.
-- roles.sql grants metra_app no DELETE either, so a delete is refused twice.
--
--   site_photos              status, client_visible, caption, voided_at,
--                            voided_by, updated_at
--   site_material_receipts,
--   site_notes               voided_at, voided_by, updated_at
--
-- WHO VOIDS: for metra_app, `voided_by` is the current user (S2 security S2):
-- a void is never stamped in someone else's name.
--
-- WHY NOT enforce_immutable_when: that factory freezes a row by STATUS; a diary
-- row is frozen from its insert, column by column.
--
-- NOT security definer. `set search_path = ''`: every name lives in
-- pg_catalog (to_jsonb, the jsonb `-` operator, array_to_string).
create or replace function public.enforce_site_entry_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'a site diary row is evidence and is never deleted (% %)', TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  if OLD.voided_at is not null then
    if to_jsonb(NEW) is distinct from to_jsonb(OLD) then
      raise exception 'a voided site diary row is final: nothing about it changes (% %)', TG_TABLE_NAME, OLD.id
        using errcode = 'MT100';
    end if;
    return NEW;
  end if;

  if (to_jsonb(NEW) - TG_ARGV) is distinct from (to_jsonb(OLD) - TG_ARGV) then
    raise exception 'a site diary row is evidence: only % may change (% %)',
      array_to_string(TG_ARGV, ', '), TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  if current_user = 'metra_app'
     and NEW.voided_at is not null
     and NEW.voided_by is distinct from nullif(current_setting('app.current_user_id', true), '')::uuid then
    raise exception 'a void is stamped with the user who makes it (% %)', TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;

-- A photo's two states that are not evidence but decisions:
--   * `status` goes pending -> stored and never back (S2 functional F5): a
--     stored photo was seen in object storage;
--   * what the client may see of it, `client_visible` and `caption`, changes
--     only for a manager (S2 security S2), as the visit's publication does.
-- The column freeze and the void are trg_site_photos_guard's
-- (enforce_site_entry_guard), which runs on the same UPDATE.
--
-- NOT security definer (it calls the definer gate). `set search_path = ''`.
create or replace function public.enforce_site_photo_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if OLD.status = 'stored' and NEW.status = 'pending' then
    raise exception 'a stored site photo never goes back to pending (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if current_user = 'metra_app'
     and (NEW.client_visible is distinct from OLD.client_visible or NEW.caption is distinct from OLD.caption)
     and not public.app_may_manage_site_project() then
    raise exception 'only an owner, admin or project manager changes a site photo''s client visibility or caption (%)', OLD.id
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;

-- A site visit is evidence too. An UPDATE may change only:
--   * checked_out_at, once (null -> a time; a second check-out is the core's
--     `already`, never a new time);
--   * the publication columns (published_at, published_by, client_caption_ar,
--     client_caption_en), which publish and unpublish move both ways, and
--     which for metra_app only a manager changes, `published_by` being the
--     current user whenever a publication is stamped (S2 security S2);
--   * lat and lng, and ONLY to null: the 90-day coordinate purge. Coordinates
--     are never moved to another value;
--   * updated_at.
-- Anything else, and every DELETE, raises MT100.
--
-- NOT security definer (it calls the definer gate). `set search_path = ''`.
create or replace function public.enforce_site_visit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mutable constant text[] := array[
    'checked_out_at', 'published_at', 'published_by', 'client_caption_ar',
    'client_caption_en', 'lat', 'lng', 'updated_at'
  ];
begin
  if TG_OP = 'DELETE' then
    raise exception 'a site visit is evidence and is never deleted (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if (to_jsonb(NEW) - v_mutable) is distinct from (to_jsonb(OLD) - v_mutable) then
    raise exception 'a site visit is evidence: only the check-out, the publication and the purge may change it (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if OLD.checked_out_at is not null and NEW.checked_out_at is distinct from OLD.checked_out_at then
    raise exception 'a check-out is recorded once (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if (NEW.lat is distinct from OLD.lat and NEW.lat is not null)
     or (NEW.lng is distinct from OLD.lng and NEW.lng is not null) then
    raise exception 'coordinates are only ever purged, never moved (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if current_user = 'metra_app'
     and (NEW.published_at, NEW.published_by, NEW.client_caption_ar, NEW.client_caption_en)
         is distinct from (OLD.published_at, OLD.published_by, OLD.client_caption_ar, OLD.client_caption_en) then
    if not public.app_may_manage_site_project() then
      raise exception 'only an owner, admin or project manager publishes, unpublishes or captions a site visit (%)', OLD.id
        using errcode = 'MT100';
    end if;
    if NEW.published_by is not null
       and (NEW.published_at, NEW.published_by) is distinct from (OLD.published_at, OLD.published_by)
       and NEW.published_by is distinct from nullif(current_setting('app.current_user_id', true), '')::uuid then
      raise exception 'a publication is stamped with the user who makes it (%)', OLD.id
        using errcode = 'MT100';
    end if;
  end if;

  return NEW;
end
$$;

-- The diary day of a check-in is the DATABASE's (S2 functional F3): for
-- metra_app, `visit_date` is the Africa/Cairo calendar date of
-- `checked_in_at`. Left out, it is derived; written, it must be that date, or
-- the insert is refused (MT100), because the guard above then freezes it and
-- the client's feed pages by it. The TypeScript twin is
-- apps/web/src/lib/site/visit-date.ts (cairoDate).
--
-- NOT security definer. `set search_path = ''` (the time zone conversion and
-- the date cast are pg_catalog's).
create or replace function public.enforce_site_visit_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cairo_day date;
begin
  if current_user <> 'metra_app' then
    return NEW;
  end if;

  v_cairo_day := (NEW.checked_in_at at time zone 'Africa/Cairo')::date;
  if NEW.visit_date is null then
    NEW.visit_date := v_cairo_day;
  elsif NEW.visit_date is distinct from v_cairo_day then
    raise exception 'a site visit''s date is the Cairo day of its check-in: % is not %', NEW.visit_date, v_cairo_day
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;

-- A revoke is FINAL (S2 security S1), on project_assignments and site_devices:
-- once `revoked_at` is set, neither it nor `revoked_by` changes again, so a
-- revoked assignment or phone never comes back to life. A re-assignment is a
-- NEW row (the partial unique index on live assignments allows it); a phone
-- signs in again with a new session. For metra_app, `revoked_by` is the
-- current user whenever a revoke is stamped.
--
-- NOT security definer. `set search_path = ''`.
create or replace function public.enforce_site_revoke_final()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if OLD.revoked_at is not null
     and (NEW.revoked_at is distinct from OLD.revoked_at or NEW.revoked_by is distinct from OLD.revoked_by) then
    raise exception 'a revoke is final; assign again with a new row (% %)', TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  if current_user = 'metra_app'
     and OLD.revoked_at is null
     and NEW.revoked_at is not null
     and NEW.revoked_by is distinct from nullif(current_setting('app.current_user_id', true), '')::uuid then
    raise exception 'a revoke is stamped with the user who makes it (% %)', TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;

-- The SITE PIN on projects is the ruler presence is measured against, so who
-- may set it is a database fact (S2 security S2), for metra_app:
--   * a manager sets, moves and clears it;
--   * an assigned site engineer only SETS a missing one (the "no pin yet,
--     use my position" path), never moves or clears one;
--   * `site_pin_set_by`, when set, is the current user.
-- Every other member changes none of the five pin columns. The trigger is
-- `BEFORE UPDATE OF` the five, and an UPDATE that leaves them as they were
-- passes untouched.
--
-- NOT security definer (it calls the definer gates). `set search_path = ''`.
create or replace function public.enforce_site_pin_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'metra_app'
     or (NEW.site_lat, NEW.site_lng, NEW.site_radius_m, NEW.site_pin_set_by, NEW.site_pin_set_at)
        is not distinct from (OLD.site_lat, OLD.site_lng, OLD.site_radius_m, OLD.site_pin_set_by, OLD.site_pin_set_at) then
    return NEW;
  end if;

  if not (
    public.app_may_manage_site_project()
    or (OLD.site_lat is null and public.app_may_write_site_project(OLD.id))
  ) then
    raise exception 'only an owner, admin or project manager moves or clears a site pin; an assigned site engineer only sets a missing one (%)', OLD.id
      using errcode = 'MT100';
  end if;

  if NEW.site_pin_set_by is distinct from nullif(current_setting('app.current_user_id', true), '')::uuid
     and NEW.site_pin_set_by is not null then
    raise exception 'a site pin is stamped with the user who sets it (%)', OLD.id
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;
