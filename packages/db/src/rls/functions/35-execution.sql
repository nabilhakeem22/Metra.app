-- rls/functions/35-execution.sql: Stage 2 execution (migration 0063): the
-- payment request's frozen guard and the payment-fits guard; from DB step B
-- also the cost entry's guard and the actor check of the money writers.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Idempotent (`create or replace`). The triggers that use them are
-- attached in rls/policies/35-execution.sql, beside the tables' policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- A payment request (مطالبة دفع) is a FROZEN document from the moment it is
-- written. Exactly one change is allowed: `issued -> void`, which may set
-- `voided_at`, `voided_by` and `updated_at` and must leave every other column
-- as it was (the void pair CHECK on the table ties the three together). Any
-- other UPDATE, and every DELETE, raises MT100. roles.sql grants metra_app no
-- DELETE either, so a delete is refused twice. A void of a request that has a
-- payment raises MT132 (`request_has_payments`), the void half of the payment
-- invariant whose insert half is enforce_contract_payment_fits below.
--
-- Reads contract_payments as the CALLER (not a definer): a void runs in the
-- studio's own org context, and RLS shows it exactly that request's payments.
--
-- WHY NOT enforce_immutable_when: that factory admits a whitelisted STATUS
-- transition that changes nothing but `status` and `updated_at`. A void must
-- also stamp who and when, so the allowed change is "status plus two named
-- columns", which the factory's arguments cannot say.
--
-- No cascade reaches this table: every foreign key INTO payment_requests is
-- RESTRICT, so there is no referential UPDATE to forgive (the factory's
-- TG_ARGV[3] case does not arise).
--
-- NOT security definer. `set search_path = ''`: every name is schema-qualified
-- or lives in pg_catalog (to_jsonb, the jsonb `-` / `=` operators), so the body
-- never depends on the caller's path.
create or replace function public.enforce_payment_request_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'a payment request is never deleted (number %)', OLD.number
      using errcode = 'MT100';
  end if;

  if OLD.status::text = 'issued' and NEW.status::text = 'void'
     and (to_jsonb(NEW) - 'status' - 'voided_at' - 'voided_by' - 'updated_at')
       = (to_jsonb(OLD) - 'status' - 'voided_at' - 'voided_by' - 'updated_at') then
    -- A paid request is never voided (A2 reliability R2). The UPDATE holds the
    -- request row by now, and a concurrent payment holds it from its insert
    -- guard to its commit, so this read (a new statement, READ COMMITTED) sees
    -- every payment that could race it.
    if exists (
      select 1 from public.contract_payments p
       where p.org_id = OLD.org_id and p.request_id = OLD.id
    ) then
      raise exception 'request_has_payments' using errcode = 'MT132';
    end if;
    return NEW;
  end if;

  raise exception
    'a payment request is frozen: only issued -> void may change it (number %, status % -> %)',
    OLD.number, OLD.status, NEW.status
    using errcode = 'MT100';
end
$$;

-- A payment always FITS its request, and the DATABASE says so (Stage 2, A2
-- reliability R2). The cores take the request row FOR UPDATE before they read
-- what is owed (plan: "Lock order for every money writer"); this guard is the
-- backstop for a writer that does not. Before every insert on
-- contract_payments it:
--   * locks the request row FOR UPDATE, which serialises concurrent payments
--     and a concurrent void of the same request (a void is an UPDATE of that
--     row). A core that already holds the lock pays nothing here;
--   * refuses unless the request is `issued`: SQLSTATE MT130, message
--     `request_void` (the core's code of the same name);
--   * refuses unless the payments already recorded plus NEW.amount stay within
--     the request's amount: SQLSTATE MT131, message `payment_exceeds_request`.
--     The sum is a new statement after the lock, so under READ COMMITTED it
--     sees every payment committed by a writer it waited for.
-- A REPLAY is let through to the arbiter: when NEW carries an idempotency key
-- that is already recorded on this contract (asked AFTER the lock, so a
-- concurrent first write of the key is settled), the guard returns NEW without
-- checking, so `ON CONFLICT ... DO NOTHING` answers it (the `already: true`
-- of recordContractPaymentCore) instead of MT131 on money already counted.
-- A request id that does not exist on (org_id, contract_id) is left to the
-- 3-column FK (23503).
--
-- LOCK ORDER: claim -> request -> payment, the plan's order. This guard only
-- ever takes the request lock, and only at the payment insert, which comes
-- after any claim lock the confirm core holds; so it adds no new lock edge and
-- cannot deadlock against the planned cores. A void core must not lock a claim
-- AFTER the request (plan A4.1 addendum).
--
-- SECURITY INVOKER (A2 security re-check S5): it reads the request and the
-- payments AS THE CALLER, under RLS. A definer would answer questions about
-- another studio's request (MT130 / MT131) before RLS refused the row; as the
-- invoker, a request the caller cannot see is "not found", the guard returns
-- NEW, and the insert's own policy refuses it (42501). metra_app holds SELECT
-- and UPDATE on payment_requests, which `FOR UPDATE` needs, and the policy is
-- org_isolation for every command, so the lock and the sum see exactly the
-- caller's own rows. The lockdown below is kept (uniform for every function
-- under rls/). `set search_path = ''`.
create or replace function public.enforce_contract_payment_fits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_amount numeric;
  v_paid   numeric;
begin
  select r.status::text, r.amount
    into v_status, v_amount
    from public.payment_requests r
   where r.org_id = NEW.org_id
     and r.contract_id = NEW.contract_id
     and r.id = NEW.request_id
   for update;
  if not found then
    return NEW;
  end if;

  -- After the lock, so a concurrent first write of the same key has committed
  -- (or rolled back) by the time this is asked.
  if NEW.idempotency_key is not null and exists (
    select 1 from public.contract_payments p
     where p.org_id = NEW.org_id
       and p.contract_id = NEW.contract_id
       and p.idempotency_key = NEW.idempotency_key
  ) then
    return NEW;
  end if;

  if v_status <> 'issued' then
    raise exception 'request_void' using errcode = 'MT130';
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid
    from public.contract_payments p
   where p.org_id = NEW.org_id
     and p.request_id = NEW.request_id;
  if v_paid + NEW.amount > v_amount then
    raise exception 'payment_exceeds_request' using errcode = 'MT131';
  end if;

  return NEW;
end
$$;

-- Same-transaction lockdown (new-function-lockdown.test.ts): a NEW function is
-- executable by PUBLIC from the moment CREATE commits. It is a trigger
-- function (a direct call fails anyway) and an invoker; the lockdown keeps the
-- rule uniform for every function this file creates.
revoke all on function public.enforce_contract_payment_fits() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.enforce_contract_payment_fits() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.enforce_contract_payment_fits() to metra_app;
  end if;
end
$$;

-- A cost entry (المصروفات) is edited and voided, never re-homed or un-voided
-- (DB step B, B3 security S2). roles.sql already narrows metra_app's UPDATE to
-- the entry fields and the void stamp; this guard says the same to every
-- role, the connection role included: an UPDATE that changes `id`, `org_id`,
-- `contract_id`, `recorded_by`, `idempotency_key` or `created_at` raises
-- MT100, and so does one that clears or rewrites the void stamp of a voided
-- entry. Anything else passes, the referential `SET NULL (cost_item_id)` of a
-- deleted price-book item included.
--
-- NOT security definer: it reads only OLD and NEW. `set search_path = ''`.
create or replace function public.enforce_cost_entry_guarded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.id is distinct from OLD.id
     or NEW.org_id is distinct from OLD.org_id
     or NEW.contract_id is distinct from OLD.contract_id
     or NEW.recorded_by is distinct from OLD.recorded_by
     or NEW.idempotency_key is distinct from OLD.idempotency_key
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'a cost entry keeps its contract, its recorder, its key and its creation time (id %)', OLD.id
      using errcode = 'MT100';
  end if;
  if OLD.voided_at is not null
     and (NEW.voided_at is distinct from OLD.voided_at or NEW.voided_by is distinct from OLD.voided_by) then
    raise exception 'a voided cost entry stays voided (id %)', OLD.id
      using errcode = 'MT100';
  end if;
  return NEW;
end
$$;

-- Same-transaction lockdown, as for enforce_contract_payment_fits above.
revoke all on function public.enforce_cost_entry_guarded() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.enforce_cost_entry_guarded() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.enforce_cost_entry_guarded() to metra_app;
  end if;
end
$$;

-- WHO did it is the session's user, and the DATABASE says so (DB step B, A4
-- security S3). The money writers stamp an actor column from the request's
-- session (`ctx.userId`); this guard refuses a row that names anyone else, so
-- no app path, and no SQL that reached metra_app past the ORM, can record a
-- payment, a request, a void or a cost in another member's name.
--
-- TG_ARGV names the actor columns of the table it is attached to. Every one
-- that the write SETS (on INSERT, any non-null value; on UPDATE, a value that
-- changed and is not null) must equal the `app.current_user_id` GUC, which
-- withOrgContext (packages/db/src/org-context.ts) sets on every app
-- transaction; a missing GUC refuses too. SQLSTATE MT140, message
-- `actor_not_session_user`.
--
-- ONLY FOR metra_app. The connection role (migrations, the owner's CLIs, the
-- test fixtures) writes as itself with no session, so it is not asked; the app
-- always writes as metra_app (SET LOCAL ROLE). SECURITY INVOKER, so
-- `current_user` is the role that wrote. `to_jsonb` reads a column by its
-- name: the three tables are written a few rows at a time, so its per-row cost
-- does not matter here. `set search_path = ''`.
create or replace function public.enforce_actor_is_session_user()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session text;
  v_column  text;
  v_new     text;
begin
  if current_user <> 'metra_app' then
    return NEW;
  end if;
  v_session := nullif(current_setting('app.current_user_id', true), '');
  foreach v_column in array TG_ARGV loop
    v_new := to_jsonb(NEW) ->> v_column;
    continue when v_new is null;
    continue when TG_OP = 'UPDATE' and v_new is not distinct from (to_jsonb(OLD) ->> v_column);
    if v_session is null or v_new <> v_session then
      raise exception 'actor_not_session_user' using errcode = 'MT140',
        detail = format('%s.%s must name the session user', TG_TABLE_NAME, v_column);
    end if;
  end loop;
  return NEW;
end
$$;

-- Same-transaction lockdown, as above.
revoke all on function public.enforce_actor_is_session_user() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.enforce_actor_is_session_user() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.enforce_actor_is_session_user() to metra_app;
  end if;
end
$$;
