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
-- immutability. (On a COMPOSITE (org_id, x_id) FK, Postgres used to null org_id
-- as well, so that delete was refused for an unrelated reason; migration 0052
-- narrowed all twelve of ours to `SET NULL (x_id)`.) Only a change TO NULL is
-- tolerated;
-- writing a new NON-NULL value into one of those columns is still MT100. OMIT
-- IT AND THE TRIGGER BEHAVES EXACTLY AS IT DID BEFORE THIS ARGUMENT EXISTED -
-- every attached trigger that passes three arguments cannot reach the branch at
-- all.
--
-- ONLY A REFERENTIAL CASCADE MAY USE IT (`pg_trigger_depth() > 1`). The comment
-- said "columns the DATABASE ITSELF may null out", but the branch could not tell
-- a cascade from a hand-written statement, so as first shipped
-- `update boqs set engagement_id = null` on an ISSUED bill - from metra_app,
-- from any future code path, from a copy-pasted script - was admitted, detaching
-- an issued document from its engagement and detaching the spreadsheet the
-- client was actually sent. All three raised MT100 before the argument existed.
-- A referential ON DELETE SET NULL action reaches the child's BEFORE UPDATE from
-- inside the parent's internal RI trigger, so it arrives at depth >= 2; a direct
-- application UPDATE arrives at depth 1. Nothing in this repo updates a locked
-- table from a trigger, so the test is exact.
--
-- AND `updated_at` IS ONLY FORGIVEN WHEN A NAMED COLUMN ACTUALLY WENT NULL.
-- Stripping it unconditionally meant a bare `set updated_at = now()` on a locked
-- row was admitted by this branch - a locked document's timestamp could be moved
-- on its own, which is not something a cascade ever does.
--
-- CONSEQUENCE, stated so nobody reads the branch as dead: with the depth gate in
-- place, branch 2 is reachable ONLY from a cascade, and until migration 0052 no
-- such cascade could complete (the composite FK nulled `org_id` too, which is
-- NOT NULL, so the parent delete was refused first). 0052 narrowed all twelve to
-- `ON DELETE SET NULL (x_id)`, so the branch NOW CARRIES REAL TRAFFIC - deleting
-- a document or a design engagement that an ISSUED bill points at is exactly it,
-- and `tests/actions/composite-fk-cascade.dbtest.ts` is where that is proven.
--
-- Decision matrix for "cannot be edited once issued":
--   * append-only ledgers (e.g. audit_log) -> use GRANTs (no UPDATE/DELETE), and
--   * status-locked business rows (invoice/contract/variation) -> use THIS trigger.
--
-- Raises SQLSTATE MT100 (reserved: immutability violation) on any illegal change.
-- Idempotent (create or replace); attached to no table here.

-- `set search_path = ''` for the same reason enforce_account_id_immutable below
-- has it: every name this body uses (to_jsonb, string_to_array, replace,
-- coalesce, cardinality, pg_trigger_depth, the jsonb `-` and `=` operators)
-- lives in pg_catalog, which is always implicitly on the path, so pinning the
-- path costs nothing and stops the resolution depending on the INVOKING role's
-- search_path. It was the one function of the thirty under rls/ without it, and
-- this wave added new logic to it. No body change is needed: nothing here is
-- resolved through `public`.
create or replace function public.enforce_immutable_when()
returns trigger
language plpgsql
set search_path = ''
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
  nulled      boolean := false;
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

  -- Branch 2 - the `on delete set null` cascade. Three fences, all required:
  --   * TG_ARGV[3] names columns, so a three-argument trigger cannot reach it;
  --   * the status is unchanged;
  --   * pg_trigger_depth() > 1, so ONLY a referential action can be the writer.
  --     A direct UPDATE arrives at depth 1 and falls through to MT100.
  -- Each named column is then ignored ONLY when it actually WENT null - a
  -- cascade nulls a column, it never writes a new value into one - and
  -- `updated_at` is forgiven only if at least one of them did. Everything else
  -- must still be byte-identical.
  if cardinality(cascade_cols) > 0
     and new_status is not distinct from old_status
     and pg_trigger_depth() > 1 then
    new_body := to_jsonb(NEW) - status_col;
    old_body := to_jsonb(OLD) - status_col;
    foreach col in array cascade_cols loop
      if col <> ''
         and (new_body ->> col) is null
         and (old_body ->> col) is not null then
        new_body := new_body - col;
        old_body := old_body - col;
        nulled := true;
      end if;
    end loop;
    if nulled then
      new_body := new_body - 'updated_at';
      old_body := old_body - 'updated_at';
    end if;
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
