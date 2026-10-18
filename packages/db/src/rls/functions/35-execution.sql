-- rls/functions/35-execution.sql: Stage 2 execution (migration 0063), the
-- payment request's frozen guard.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Idempotent (`create or replace`). The trigger that uses it is
-- attached in rls/policies/35-execution.sql, beside the table's policy.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- A payment request (مطالبة دفع) is a FROZEN document from the moment it is
-- written. Exactly one change is allowed: `issued -> void`, which may set
-- `voided_at`, `voided_by` and `updated_at` and must leave every other column
-- as it was (the void pair CHECK on the table ties the three together). Any
-- other UPDATE, and every DELETE, raises MT100. roles.sql grants metra_app no
-- DELETE either, so a delete is refused twice.
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
-- NOT security definer: it reads no table, only OLD and NEW. `set search_path
-- = ''` because to_jsonb and the jsonb `-` / `=` operators live in pg_catalog,
-- which is always on the path, so the body never depends on the caller's path.
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
    return NEW;
  end if;

  raise exception
    'a payment request is frozen: only issued -> void may change it (number %, status % -> %)',
    OLD.number, OLD.status, NEW.status
    using errcode = 'MT100';
end
$$;
