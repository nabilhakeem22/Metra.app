-- merta_app: the request-time identity. NOLOGIN + NOBYPASSRLS so it can never
-- see across tenants. The connection role (postgres) OWNS the tables and would
-- bypass RLS, which is why every table also has FORCE ROW LEVEL SECURITY and why
-- the app switches into merta_app via `SET LOCAL ROLE merta_app` per request.
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'merta_app') then
    create role merta_app nologin noinherit nobypassrls;
  end if;
end
$$;

-- Let the connection role switch into merta_app.
grant merta_app to postgres;

grant usage on schema public to merta_app;

-- Full DML on business tables...
grant select, insert, update, delete on public.organizations to merta_app;
grant select, insert, update, delete on public.memberships   to merta_app;
grant select, insert, update, delete on public.files         to merta_app;

-- ...except audit_log, which is append-only (§4.4). No UPDATE / DELETE grant,
-- so any attempt raises a permission error at the database.
grant select, insert on public.audit_log to merta_app;

-- Future-proofing for composite-FK trigger functions.
grant execute on function public.enforce_same_org() to merta_app;

-- Bootstrap user->org lookup (SECURITY DEFINER, scoped to app.current_user_id).
grant execute on function public.app_current_user_memberships() to merta_app;
