-- metra_app: the request-time identity. NOLOGIN + NOBYPASSRLS so it can never
-- see across tenants. The connection role (postgres) OWNS the tables and would
-- bypass RLS, which is why every table also has FORCE ROW LEVEL SECURITY and why
-- the app switches into metra_app via `SET LOCAL ROLE metra_app` per request.
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'metra_app') then
    create role metra_app nologin noinherit nobypassrls;
  end if;
end
$$;

-- Let the connection role switch into metra_app.
grant metra_app to postgres;

grant usage on schema public to metra_app;

-- Full DML on business tables...
grant select, insert, update, delete on public.organizations to metra_app;
grant select, insert, update, delete on public.memberships   to metra_app;
grant select, insert, update, delete on public.files         to metra_app;
grant select, insert, update, delete on public.invitations   to metra_app;

-- ...except audit_log, which is append-only (§4.4). No UPDATE / DELETE grant,
-- so any attempt raises a permission error at the database.
grant select, insert on public.audit_log to metra_app;

-- Future-proofing for composite-FK trigger functions.
grant execute on function public.enforce_same_org() to metra_app;

-- Bootstrap user->org lookup (SECURITY DEFINER, scoped to app.current_user_id).
-- Least privilege: CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke
-- that (and the Supabase api roles where they exist) so ONLY metra_app can call
-- this bypass-RLS function. Guarded so it is safe on a plain Postgres (CI) where
-- anon/authenticated/service_role do not exist.
grant execute on function public.app_current_user_memberships() to metra_app;
revoke execute on function public.app_current_user_memberships() from public;

-- Invitation-by-token lookup (SECURITY DEFINER); same least-privilege treatment.
grant execute on function public.app_invitation_by_token(text) to metra_app;
revoke execute on function public.app_invitation_by_token(text) from public;

-- Current-user orgs (SECURITY DEFINER); same least-privilege treatment.
grant execute on function public.app_current_user_orgs() to metra_app;
revoke execute on function public.app_current_user_orgs() from public;

-- Membership second-factor helpers for RLS (SECURITY DEFINER); same treatment.
grant execute on function public.app_is_current_org_member() to metra_app;
revoke execute on function public.app_is_current_org_member() from public;
grant execute on function public.app_can_bootstrap_membership() to metra_app;
revoke execute on function public.app_can_bootstrap_membership() from public;
grant execute on function public.app_claim_invitation(uuid) to metra_app;
revoke execute on function public.app_claim_invitation(uuid) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke execute on function public.app_current_user_memberships() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_invitation_by_token(text) from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_current_user_orgs() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_is_current_org_member() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_can_bootstrap_membership() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_claim_invitation(uuid) from %I',
        r
      );
    end if;
  end loop;
end
$$;
