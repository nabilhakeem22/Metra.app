-- rls/functions/00-org-context.sql — org context, membership second factor, invitation claim, account bootstrap.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- DEPRECATED for hot paths — prefer the declarative composite FK from
-- sameOrgFk() (packages/db/src/schema/org-ref.ts): (org_id, <name>_id) ->
-- target(org_id, id) enforces same-org at the DB with no per-row trigger.
-- Reserve enforce_same_org for non-composite / cross-schema targets only.
--
-- Reusable trigger function for composite same-org foreign keys. Not attached to
-- any table in P0 (no child business tables exist yet), but shipped so P1+ child
-- tables can guarantee a referenced row lives in the same org as the referrer.
--
-- Usage on a future table:
--   create trigger trg_lines_same_org
--     before insert or update on public.proposal_lines
--     for each row execute function enforce_same_org('proposals', 'proposal_id');
--   -- args: [0] referenced table (public schema), [1] this table's FK column.

create or replace function public.enforce_same_org()
returns trigger
language plpgsql
as $$
declare
  ref_table text := TG_ARGV[0];
  fk_column text := TG_ARGV[1];
  fk_value  uuid;
  ref_org   uuid;
begin
  fk_value := (to_jsonb(NEW) ->> fk_column)::uuid;
  if fk_value is null then
    return NEW;
  end if;

  execute format('select org_id from public.%I where id = $1', ref_table)
    into ref_org
    using fk_value;

  if ref_org is null then
    raise exception
      'enforce_same_org: referenced % row % not found', ref_table, fk_value;
  end if;

  if ref_org <> NEW.org_id then
    raise exception
      'enforce_same_org: cross-org reference blocked on %.% -> %',
      TG_TABLE_NAME, fk_column, ref_table;
  end if;

  return NEW;
end
$$;

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
