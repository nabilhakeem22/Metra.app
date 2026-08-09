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
