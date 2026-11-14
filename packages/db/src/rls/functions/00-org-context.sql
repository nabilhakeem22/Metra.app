-- rls/functions/00-org-context.sql — org context, membership second factor, invitation claim, account bootstrap.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- RETIRED (security batch 3, A4): the per-row same-org trigger function. No
-- table ever attached it: same-org references are the composite foreign keys
-- of sameOrgFk() (packages/db/src/schema/org-ref.ts), which need no trigger.
-- It was a SECURITY INVOKER function with no pinned search_path (a Supabase
-- advisor finding) and nothing called it, so it is dropped rather than
-- pinned. apply-rls never drops a function on its own, so this DROP is what
-- removes it from a database provisioned before; `if exists` keeps a re-run
-- quiet. Without CASCADE on purpose: were a trigger ever attached to it by
-- hand, the DROP fails and this file rolls back whole, instead of silently
-- removing that trigger.
drop function if exists public.enforce_same_org();

-- Bootstrap lookup for requireOrg: resolve which org(s) the CURRENT authenticated
-- user belongs to BEFORE any org context exists. SECURITY DEFINER runs as the
-- owner (postgres, BYPASSRLS) so it is not filtered by FORCE RLS, but it is
-- tightly scoped to exactly `app.current_user_id` — it can never return another
-- user's rows and never widens org visibility (no permissive policy on the
-- business table). empty search_path forces fully-qualified names.
create or replace function public.app_current_user_memberships()
returns table (org_id uuid, role public.member_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, m.role
  from public.memberships m
  where m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Invitation lookup by token hash, BEFORE any org context exists (the accept
-- flow does not know which org it is until it resolves the token). SECURITY
-- DEFINER bypasses FORCE RLS but returns at most the single row matching the
-- exact token hash — no enumeration, no widening. The caller re-validates
-- status/expiry/email and only then enters that org's context.
create or replace function public.app_invitation_by_token(p_token_hash text)
returns table (
  id uuid,
  org_id uuid,
  email text,
  role public.member_role,
  status public.invitation_status,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.org_id, i.email, i.role, i.status, i.expires_at
  from public.invitations i
  where i.token_hash = p_token_hash
$$;

-- The current user's orgs (with role, display names + owning account), for the
-- org switcher and requireOrg's active-org validation. SECURITY DEFINER, scoped
-- to app.current_user_id — returns only the caller's own memberships, no widening.
-- Dropped first because the return type gained account columns (A3): create or
-- replace cannot change a function's return type. The signature (name + 0 args)
-- is unchanged, so roles.sql re-grants/re-revokes it after this file runs (DROP
-- resets privileges). LEFT JOIN so an org not yet linked to an account still
-- returns, with account_* NULL. No policy depends on this function.
drop function if exists public.app_current_user_orgs();
create or replace function public.app_current_user_orgs()
returns table (
  org_id uuid,
  role public.member_role,
  name_ar text,
  name_en text,
  account_id uuid,
  account_name_ar text,
  account_name_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, m.role, o.name_ar, o.name_en, a.id, a.name_ar, a.name_en
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  left join public.accounts a on a.id = o.account_id
  where m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Locked down in the SAME implicit transaction as the drop and CREATE above
-- (Round E, S2): the drop resets the ACL to the default EXECUTE for PUBLIC (and,
-- on Supabase, the API roles), and roles.sql, which revokes that too, runs
-- several files later in its own transaction; a run that failed in between
-- left it open. The metra_app grant is guarded because on a fresh database
-- roles.sql, which creates that role, has not run yet.
revoke all on function public.app_current_user_orgs() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_current_user_orgs() from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_current_user_orgs() to metra_app;
  end if;
end
$$;

-- The current user's orgs AS SEEN FROM ONE AUTH SESSION (Stage 3, 0064): the
-- same rows as app_current_user_orgs(), minus every org in which the caller's
-- site device for that session (site_devices.auth_session_id = the JWT
-- `session_id` claim) has been REVOKED. So an owner who revokes a phone cuts
-- that phone from that studio only, in the site app and in the studio pages,
-- while the same user's other studios, and his other sessions, keep working.
-- An unknown session (no device row) loses nothing.
--
-- SECURITY DEFINER, scoped to app.current_user_id exactly like its sibling,
-- which it reads rather than repeats; the device rows it consults are the
-- caller's own. It never widens: it can only return FEWER rows than
-- app_current_user_orgs(). Not dropped first: it is new, and its return type
-- is its sibling's. (A `$$` body records no dependency, so the sibling's own
-- drop above still runs; this CREATE re-validates against it in the same
-- transaction.)
create or replace function public.app_current_user_orgs_for_session(p_session_id uuid)
returns table (
  org_id uuid,
  role public.member_role,
  name_ar text,
  name_en text,
  account_id uuid,
  account_name_ar text,
  account_name_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.org_id, o.role, o.name_ar, o.name_en, o.account_id, o.account_name_ar, o.account_name_en
  from public.app_current_user_orgs() o
  where not exists (
    select 1
      from public.site_devices d
     where d.org_id = o.org_id
       and d.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
       and d.auth_session_id = p_session_id
       and d.revoked_at is not null
  )
$$;

-- Same-transaction lockdown, as for its sibling: a NEW function is executable
-- by PUBLIC from the moment CREATE commits, and roles.sql runs several files
-- later.
revoke all on function public.app_current_user_orgs_for_session(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_current_user_orgs_for_session(uuid) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_current_user_orgs_for_session(uuid) to metra_app;
  end if;
end
$$;

-- ===========================================================================
-- Membership second factor for RLS. These run inside the request transaction
-- (as metra_app, which is granted execute) and read the request GUCs. SECURITY
-- DEFINER so they can consult memberships/invitations WITHOUT being filtered by
-- the very policies they support (no recursion). Each is tightly scoped to the
-- session's own org/user/email — never widens visibility.
-- ===========================================================================

-- Is the session user a member of the current org? Used in every table's USING.
create or replace function public.app_is_current_org_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id  = nullif(current_setting('app.current_org_id',  true), '')::uuid
      and m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

-- May the session user create their OWN founding/accepted membership? True only
-- when (a) the org has NO members yet (createOrg founding owner), or (b) the
-- session user has an ACCEPTED invitation in this org matching their email
-- (acceptInvite). This is the ONLY bootstrap carve-out; it is scoped to the
-- caller's own user/email so it can never become a self-join backdoor.
create or replace function public.app_can_bootstrap_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from public.memberships m
      where m.org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    )
    or exists (
      select 1 from public.invitations i
      where i.org_id      = nullif(current_setting('app.current_org_id',   true), '')::uuid
        and i.status      = 'accepted'
        and i.accepted_by = nullif(current_setting('app.current_user_id',  true), '')::uuid
        and lower(i.email) = lower(nullif(current_setting('app.current_user_email', true), ''))
    );
$$;

-- ===========================================================================
-- Who may write a membership's ROLE (security batch 3, A5). The memberships
-- policy (policies/00-core.sql) says WHICH ORG a row may be written in; it
-- says nothing about the role column, so any member could write any role,
-- owner included, and the bootstrap insert was not held to the invitation's
-- role. The app has always enforced both (lib/team/core); these two functions
-- say it again at the database, behind trg_memberships_role_writer.
-- ===========================================================================

-- Who is writing a membership row, read as the owner so RLS cannot hide it.
-- GUC-scoped, no argument: it answers only for the session's own org, user and
-- email, so it never widens what the caller can learn.
--   caller_role      the session user's role in the current org, or NULL
--   org_has_members  whether the current org has any member yet
--   invited_role     the role of the invitation the session user CLAIMED IN THIS
--                    TRANSACTION (app_claim_invitation stamps accepted_at with
--                    now(), the transaction's start), or NULL. An invitation
--                    accepted in an earlier transaction authorises nothing.
create or replace function public.app_membership_writer_facts()
returns table (caller_role text, org_has_members boolean, invited_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select m.role::text from public.memberships m
      where m.org_id  = nullif(current_setting('app.current_org_id', true), '')::uuid
        and m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid),
    exists (select 1 from public.memberships m
      where m.org_id = nullif(current_setting('app.current_org_id', true), '')::uuid),
    (select i.role::text from public.invitations i
      where i.org_id      = nullif(current_setting('app.current_org_id', true), '')::uuid
        and i.status      = 'accepted'
        and i.accepted_by = nullif(current_setting('app.current_user_id', true), '')::uuid
        and lower(i.email) = lower(nullif(current_setting('app.current_user_email', true), ''))
        and i.accepted_at = now()
      order by i.accepted_at desc limit 1);
$$;

-- Same-transaction lockdown: a NEW function is executable by PUBLIC from the
-- moment CREATE commits, and roles.sql runs several files later. The trigger
-- function below calls it AS THE CALLER, so metra_app keeps EXECUTE; the grant
-- is guarded because on a fresh database roles.sql, which creates that role,
-- has not run yet.
revoke all on function public.app_membership_writer_facts() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_membership_writer_facts() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_membership_writer_facts() to metra_app;
  end if;
end
$$;

-- The rule, on every membership INSERT, UPDATE and DELETE (SQLSTATE MT150,
-- message `membership_write_refused`, the reason in DETAIL):
--   * a membership never moves to another studio or person (org_id, user_id);
--   * an UPDATE that leaves the role as it was is not judged;
--   * a NON-MEMBER may insert only their OWN row: as `owner` when the studio
--     has no member yet (createOrg), otherwise with exactly the role of the
--     invitation claimed in this transaction (acceptInvite), and NEVER as
--     owner. The invitations policy does not hold the role an invitation
--     names (any member may write an invitation row), so an invitation that
--     says owner is not believed: owner is granted by an owner, to a member;
--   * anyone else must be an owner or admin of the studio to grant, change or
--     remove a role, and an OWNER to grant owner, demote an owner or remove one.
-- The last-owner rule stays the app's, under its advisory lock.
--
-- ONLY FOR metra_app. The connection role (migrations, the seed's fixtures,
-- the owner's SQL, the fixture purge) writes as itself with no session, so it
-- is not asked; the app always writes as metra_app (SET LOCAL ROLE). SECURITY
-- INVOKER, so `current_user` is the role that wrote. No app path maps MT150:
-- every one refuses earlier with its own code, so it reaching the app is a bug.
--
-- WHAT IT DOES NOT STOP: arbitrary SQL that already runs as metra_app and sets
-- the session GUCs itself. Like the actor check (functions/35-execution.sql),
-- it is a guard against app bugs and against SQL injected into one statement,
-- not a boundary against the app role.
create or replace function public.enforce_membership_role_writer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_facts   record;
  v_old     text;
  v_new     text;
  v_refusal text;
  v_session uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
begin
  if current_user <> 'metra_app' then
    return coalesce(NEW, OLD);
  end if;
  if TG_OP <> 'INSERT' then v_old := OLD.role::text; end if;
  if TG_OP <> 'DELETE' then v_new := NEW.role::text; end if;
  if TG_OP = 'UPDATE' then
    if NEW.org_id <> OLD.org_id or NEW.user_id <> OLD.user_id then
      v_refusal := 'a membership never moves to another studio or person';
    elsif v_new = v_old then
      return NEW;
    end if;
  end if;
  if v_refusal is null then
    select * into v_facts from public.app_membership_writer_facts();
    if TG_OP = 'INSERT' and v_facts.caller_role is null then
      if NEW.user_id is distinct from v_session then
        v_refusal := 'a non-member may add only their own membership';
      elsif not v_facts.org_has_members and v_new <> 'owner' then
        v_refusal := 'the first member of a studio is its owner';
      elsif v_facts.org_has_members and v_new = 'owner' then
        v_refusal := 'an invitation never grants owner';
      elsif v_facts.org_has_members and v_facts.invited_role is distinct from v_new then
        v_refusal := 'a joining member takes the role of the invitation claimed in this transaction';
      end if;
    elsif coalesce(v_facts.caller_role, '') not in ('owner', 'admin') then
      v_refusal := 'only an owner or admin may grant, change or remove a role';
    elsif (coalesce(v_old = 'owner', false) or coalesce(v_new = 'owner', false))
          and v_facts.caller_role <> 'owner' then
      v_refusal := 'only an owner may grant or remove owner';
    end if;
  end if;
  if v_refusal is not null then
    raise exception 'membership_write_refused' using errcode = 'MT150', detail = v_refusal;
  end if;
  return coalesce(NEW, OLD);
end
$$;

-- Same-transaction lockdown, as above.
revoke all on function public.enforce_membership_role_writer() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.enforce_membership_role_writer() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.enforce_membership_role_writer() to metra_app;
  end if;
end
$$;

-- Atomically claim a pending invitation for the session user (marks it accepted
-- with accepted_by=current user). Returns the id iff it was claimed. Guarded to
-- the current org + the invite email matching the session email. VOLATILE.
-- Dropped first because the return type changed from an earlier setof uuid form
-- (create or replace cannot change a function's return type). No policy depends
-- on this function, so the drop is safe.
drop function if exists public.app_claim_invitation(uuid);
create or replace function public.app_claim_invitation(p_invitation_id uuid)
returns table (id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invitations
     set status = 'accepted',
         accepted_by = nullif(current_setting('app.current_user_id', true), '')::uuid,
         accepted_at = now(),
         updated_at = now()
   where id = p_invitation_id
     and status = 'pending'
     and org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
     and lower(email) = lower(nullif(current_setting('app.current_user_email', true), ''))
   returning id;
$$;

-- Locked down in the SAME implicit transaction as the drop and CREATE above,
-- for the same reason as app_current_user_orgs
-- (Round E, S2): the drop resets the ACL to the default EXECUTE for PUBLIC (and,
-- on Supabase, the API roles), and roles.sql, which revokes that too, runs
-- several files later in its own transaction; a run that failed in between
-- left it open. The metra_app grant is guarded because on a fresh database
-- roles.sql, which creates that role, has not run yet.
revoke all on function public.app_claim_invitation(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_claim_invitation(uuid) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_claim_invitation(uuid) to metra_app;
  end if;
end
$$;

-- Account bootstrap (Epic A, A1). Mint ONE fresh, UNLINKED account row and return
-- its id — this is the ONLY code path that creates an account. createOrg calls it,
-- then stamps the new org's account_id; the 1:1 backfill migration seeded existing
-- orgs. SECURITY DEFINER so the insert runs as the BYPASSRLS owner: the accounts
-- policy's `with check (false)` refuses every metra_app INSERT, so accounts can be
-- created ONLY here. Scoped to nothing but the two name args — it neither reads nor
-- widens any tenant's data. Mirrors the app_claim_invitation shape (returns
-- table(id)). Least-privilege grants (metra_app only) live in roles.sql.
create or replace function public.app_bootstrap_account(
  p_name_ar text,
  p_name_en text
)
returns table (id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.accounts (name_ar, name_en)
  values (p_name_ar, p_name_en)
  returning id;
$$;
