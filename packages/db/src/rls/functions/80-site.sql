-- rls/functions/80-site.sql: Stage 3, the site diary (migration 0064): the
-- assignment write gate the restrictive insert policy calls, and the two
-- evidence guards on the diary tables.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Idempotent (`create or replace`). The triggers that use the guards
-- and the policy that uses the gate are in rls/policies/70-site.sql, beside the
-- tables' org_isolation. rls/**.sql is exempt from the 150-line rule
-- (stack-profile.md).

-- May the session user WRITE diary rows on this project? True when the
-- caller's membership in the CURRENT org is owner, admin or project_manager,
-- or is site_engineer with a LIVE assignment on the project. Every other role
-- (accountant, viewer, client) and a revoked assignment answer false.
--
-- Called by the RESTRICTIVE `site_write_assigned` insert policy on site_visits,
-- site_photos, site_material_receipts and site_notes, so the assignment rule
-- holds even for a writer that skips the core's own check (AC5). The core
-- answers `not_assigned` first; this is the second factor.
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

-- A photo, a material delivery and a note are EVIDENCE: what was recorded
-- never changes. An UPDATE may change only the columns the trigger names in
-- its arguments (TG_ARGV), and a void, once stamped, is final. Anything else,
-- and every DELETE, raises MT100. roles.sql grants metra_app no DELETE either,
-- so a delete is refused twice.
--
--   site_photos              status, client_visible, caption, voided_at,
--                            voided_by, updated_at
--   site_material_receipts,
--   site_notes               voided_at, voided_by, updated_at
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

  if (to_jsonb(NEW) - TG_ARGV) is distinct from (to_jsonb(OLD) - TG_ARGV) then
    raise exception 'a site diary row is evidence: only % may change (% %)',
      array_to_string(TG_ARGV, ', '), TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  if OLD.voided_at is not null
     and (NEW.voided_at is distinct from OLD.voided_at or NEW.voided_by is distinct from OLD.voided_by) then
    raise exception 'a void is final (% %)', TG_TABLE_NAME, OLD.id
      using errcode = 'MT100';
  end if;

  return NEW;
end
$$;

-- A site visit is evidence too. An UPDATE may change only:
--   * checked_out_at, once (null -> a time; a second check-out is the core's
--     `already`, never a new time);
--   * the publication columns (published_at, published_by, client_caption_ar,
--     client_caption_en), which publish and unpublish move both ways;
--   * lat and lng, and ONLY to null: the 90-day coordinate purge. Coordinates
--     are never moved to another value;
--   * updated_at.
-- Anything else, and every DELETE, raises MT100.
--
-- NOT security definer. `set search_path = ''`.
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

  return NEW;
end
$$;
