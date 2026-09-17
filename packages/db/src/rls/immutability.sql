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
--   --          [3] OPTIONAL: columns the DATABASE ITSELF may null out on a
--   --          locked row (csv).
--
-- ABOUT TG_ARGV[3]. It exists for `on delete set null` foreign keys: when a
-- parent row is deleted, Postgres UPDATEs the child, and a locked child would
-- otherwise raise MT100 and abort a delete that has nothing to do with
-- immutability. (On a COMPOSITE (org_id, x_id) FK, Postgres nulls org_id as
-- well, so that delete is refused for an unrelated reason until the constraint
-- is narrowed to `SET NULL (x_id)`; this argument is still what the referential
-- action needs, and is tested by the statement it issues.) Only a change TO NULL is tolerated; writing a new NON-NULL value
-- into one of those columns is still MT100. OMIT IT AND THE TRIGGER BEHAVES
-- EXACTLY AS IT DID BEFORE THIS ARGUMENT EXISTED - every attached trigger that
-- passes three arguments cannot reach the branch at all.
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
  -- TG_ARGV is TG_NARGS long; indexing past it yields NULL, not an error, so a
  -- three-argument trigger lands on an EMPTY array here and can never reach
  -- branch 2 below.
  cascade_cols text[] := string_to_array(replace(coalesce(TG_ARGV[3], ''), ' ', ''), ',');
  old_status  text;
  new_status  text;
  new_body    jsonb;
  old_body    jsonb;
  col         text;
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

  -- Branch 2 - the `on delete set null` cascade. Fires ONLY when TG_ARGV[3]
  -- names columns, so the triggers that pass three arguments cannot reach it.
  -- The status must be unchanged, and each named column is ignored ONLY when its
  -- NEW value is NULL: a cascade nulls a column, it never writes a new value
  -- into one. Everything else must still be byte-identical.
  if cardinality(cascade_cols) > 0 and new_status is not distinct from old_status then
    new_body := to_jsonb(NEW) - status_col - 'updated_at';
    old_body := to_jsonb(OLD) - status_col - 'updated_at';
    foreach col in array cascade_cols loop
      if col <> '' and (new_body ->> col) is null then
        new_body := new_body - col;
        old_body := old_body - col;
      end if;
    end loop;
    if new_body = old_body then
      return NEW;
    end if;
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
