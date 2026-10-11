-- rls/rom-issue-trigger.sql — Round D (0059 step): a changed budget band is
-- never still "issued".
--
-- The client's budget acknowledgement names the issuance it saw
-- (rom_issued_at, through the seven-argument app_delivery_respond_by_token),
-- which is sound only while EVERY change of the band clears that stamp. The
-- app's one band writer (setEngagementRom) does; this makes it the database's
-- rule too, so a future writer that forgets (an import, a bulk edit, a fix
-- script) cannot leave a new band dated with the old issuance and so record a
-- consent to numbers the client never saw.
--
-- THE RULE: an UPDATE that changes rom_low or rom_high and leaves rom_issued_at
-- as it was clears rom_issued_at. It never raises. An UPDATE that sets the band
-- AND a new stamp in one statement (an issue of new numbers) is left alone, and
-- so is one that changes only the stamp (issueRomCore).
--
-- Applied after immutability.sql and before roles.sql (rls/manifest.ts), like
-- the other trigger functions: roles.sql repeats the grant below. Invoker
-- rights, empty search_path: it only edits the row being written, and a
-- trigger's own assignment to NEW is not checked against the caller's column
-- privileges.
create or replace function public.clear_rom_issue_on_band_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (NEW.rom_low, NEW.rom_high) is distinct from (OLD.rom_low, OLD.rom_high)
     and NEW.rom_issued_at is not distinct from OLD.rom_issued_at then
    NEW.rom_issued_at := null;
  end if;
  return NEW;
end
$$;

-- Closed in the SAME implicit transaction as the CREATE above. A trigger
-- function cannot be called directly (0A000), so this is hygiene: no API role
-- holds EXECUTE on it from the moment it exists. The metra_app grant mirrors
-- the other trigger functions and is guarded because on a fresh database
-- roles.sql, which creates that role, has not run yet.
revoke all on function public.clear_rom_issue_on_band_change() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.clear_rom_issue_on_band_change() from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.clear_rom_issue_on_band_change() to metra_app;
  end if;
end
$$;

-- Fires only when the UPDATE names rom_low or rom_high; the function decides
-- whether the band actually changed.
drop trigger if exists trg_design_engagements_rom_issue on public.design_engagements;
create trigger trg_design_engagements_rom_issue
  before update of rom_low, rom_high on public.design_engagements
  for each row
  execute function public.clear_rom_issue_on_band_change();
