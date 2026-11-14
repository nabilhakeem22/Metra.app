-- rls/functions/90-sign-in.sql: the sign-in pause (security batch 3, P2;
-- migration 0067): wrong sign-in codes counted per identifier, and the pause
-- they lead to.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. rls/**.sql is exempt from the 150-line rule (stack-profile.md).
--
-- THE RULE, and the only place its two numbers are written: the TENTH wrong
-- code typed for one identifier inside its window pauses verifying for that
-- identifier until the window ends. The window is FIXED: one hour from the
-- identifier's first wrong code, one row per identifier in sign_in_failures.
-- A correct code clears nothing; the window ages out. So one identifier takes
-- at most 10 guesses an hour in the long run (20 across one window edge).
--
-- WHO CALLS THEM. The Worker's CONNECTION role, before any session or org
-- exists, exactly as it calls the token functions. Both are SECURITY DEFINER:
-- they run as their owner, which holds BYPASSRLS, and that is the only way
-- into the table (its policy refuses every role, policies/00-core.sql, and
-- metra_app holds no privilege on it, roles.sql). Both are revoked from PUBLIC,
-- the API roles and metra_app right after their CREATE, and granted to nobody:
-- the argument is a hash of the identifier, not a secret, so a role that could
-- call the record function could pause anyone's sign-in.
--
-- THE ARGUMENT is sha256 of the canonical identifier, as 64 lower-case hex
-- characters, made by the app. Neither function ever sees the identifier.

-- Seconds until this identifier may verify again, or NULL when it is not
-- paused. Read only.
create or replace function public.app_sign_in_pause_seconds(p_identifier_hash text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(1, ceil(extract(epoch from (f.window_started_at + interval '1 hour' - now())))::integer)
    from public.sign_in_failures f
   where f.identifier_hash = p_identifier_hash
     and f.failures >= 10
     and f.window_started_at > now() - interval '1 hour';
$$;

-- Same-transaction lockdown: a NEW function is executable by PUBLIC from the
-- moment CREATE commits, and roles.sql runs several files later.
revoke all on function public.app_sign_in_pause_seconds(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_sign_in_pause_seconds(text) from %I', r);
    end if;
  end loop;
end
$$;

-- Counts one wrong code; answers the pause the identifier is now in (seconds)
-- or NULL. A malformed hash is refused (22023) before anything is written.
--
-- THE UPSERT comes FIRST and is one statement, so two wrong codes typed at
-- once for one identifier are both counted. A window that ended starts again
-- at 1. The count stops at 100 (the CHECK's ceiling); the pause does not
-- depend on it past 10. `lock_timeout` 2 s: a call that cannot take its row
-- fails with 55P03 instead of holding a sign-in request, and the app carries on.
--
-- NO CRON. After counting, each call removes at most 50 rows of OTHER
-- identifiers whose window ended, oldest first, so the table holds the
-- identifiers that failed in the last hour plus a backlog that shrinks by up
-- to 50 rows per recorded failure. The 50 are picked ONCE, in a materialized
-- CTE: as an IN subquery a nested-loop plan re-ran the pick per row and
-- deleted past the cap (functions/75-client-home.sql measured that on its own
-- purge). The caller's own row is never among the 50.
--
-- THE ORDER IS THE DEADLOCK FIX, together with `skip locked`. Purging first,
-- two calls whose stale rows crossed each deleted the other's row and then
-- waited on it in their upsert: a cycle, ended by Postgres after a second
-- with one wrong code uncounted. Counting first, a call can wait only in its
-- first statement, while it holds nothing; its purge then skips every locked
-- row and waits on nothing. This holds for a call that is its own transaction,
-- which is how the app calls it.
create or replace function public.app_sign_in_failure_record(p_identifier_hash text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '2s'
as $$
declare
  v_row public.sign_in_failures%rowtype;
begin
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sign_in_failure_hash_malformed' using errcode = '22023';
  end if;

  insert into public.sign_in_failures as f (identifier_hash, window_started_at, failures)
  values (p_identifier_hash, now(), 1)
  on conflict (identifier_hash) do update
     set failures = case when f.window_started_at <= now() - interval '1 hour' then 1
                         else least(f.failures + 1, 100) end,
         window_started_at = case when f.window_started_at <= now() - interval '1 hour' then now()
                                  else f.window_started_at end
  returning * into v_row;

  with stale as materialized (
    select o.identifier_hash
      from public.sign_in_failures o
     where o.window_started_at <= now() - interval '1 hour'
       and o.identifier_hash <> p_identifier_hash
     order by o.window_started_at
     limit 50
     for update skip locked
  )
  delete from public.sign_in_failures s
   using stale d
   where s.identifier_hash = d.identifier_hash;

  if v_row.failures >= 10 then
    return greatest(1, ceil(extract(epoch from (v_row.window_started_at + interval '1 hour' - now())))::integer);
  end if;
  return null;
end
$$;

-- Same-transaction lockdown, as above.
revoke all on function public.app_sign_in_failure_record(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_sign_in_failure_record(text) from %I', r);
    end if;
  end loop;
end
$$;
