-- Reusable immutability trigger factory (P1-prep). Status-locked rows can only
-- change via a whitelisted status transition; everything else is frozen.
--
-- Adoption pattern (attach per table):
--   create trigger trg_<t>_immutable
--     before update or delete on public.<t>
--     for each row
--     execute function public.enforce_immutable_when('status','issued,signed','credited,superseded');
--   -- TG_ARGV: [0] status column, [1] locked statuses (csv), [2] allowed target
--   --          statuses a locked row may transition to (csv; '' = none).
--
-- Decision matrix for "cannot be edited once issued":
--   * append-only ledgers (e.g. audit_log) -> use GRANTs (no UPDATE/DELETE), and
--   * status-locked business rows (invoice/contract/variation) -> use THIS trigger.
--
-- Raises SQLSTATE MT100 (reserved: immutability violation) on any illegal change.
-- Idempotent (create or replace); attached to no table here.

create or replace function public.enforce_immutable_when()
returns trigger
language plpgsql
as $$
declare
  status_col  text := TG_ARGV[0];
  locked      text[] := string_to_array(replace(coalesce(TG_ARGV[1], ''), ' ', ''), ',');
  allowed     text[] := string_to_array(replace(coalesce(TG_ARGV[2], ''), ' ', ''), ',');
  old_status  text;
  new_status  text;
begin
  old_status := to_jsonb(OLD) ->> status_col;

  -- Not locked yet -> unrestricted.
  if old_status is null or not (old_status = any(locked)) then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  -- Locked row: never deletable.
  if TG_OP = 'DELETE' then
    raise exception 'immutable row (%=%) cannot be deleted', status_col, old_status
      using errcode = 'MT100';
  end if;

  -- Locked row UPDATE: allowed only if it is purely a whitelisted status
  -- transition (status + updated_at may change, nothing else).
  new_status := to_jsonb(NEW) ->> status_col;
  if (new_status = any(allowed))
     and (
       (to_jsonb(NEW) - status_col - 'updated_at')
       = (to_jsonb(OLD) - status_col - 'updated_at')
     ) then
    return NEW;
  end if;

  raise exception
    'immutable row (%=%) may only change via an allowed status transition',
    status_col, old_status
    using errcode = 'MT100';
end
$$;

-- S1 (Epic A2) — organizations.account_id is immutable ONCE SET. The A1 mapping
-- is 1:1 and billing lands on the account, so re-pointing an org to a different
-- account (or unlinking it) must never happen after the link exists. A NULL ->
-- non-null link is still permitted (the additive A1 window / a legacy backfill),
-- and a no-op UPDATE that leaves account_id unchanged passes. Raises SQLSTATE
-- MT110 (reserved: account_id immutability) on any attempt to change a set value.
-- SECURITY DEFINER + empty search_path (schema-qualify everything) so it runs
-- identically regardless of the caller's role or search_path. Idempotent.
create or replace function public.enforce_account_id_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if OLD.account_id is not null
     and NEW.account_id is distinct from OLD.account_id then
    raise exception 'organizations.account_id is immutable once set'
      using errcode = 'MT110';
  end if;
  return NEW;
end
$$;
