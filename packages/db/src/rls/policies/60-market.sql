-- rls/policies/60-market.sql: the market price book (migration 0061).
--
-- One of the policies/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Every statement here is idempotent (`drop ... if exists` /
-- `alter table ... enable`). rls/**.sql is exempt from the 150-line rule.
--
-- PLATFORM-LEVEL, READ-ONLY reference data. The four tables carry NO org_id:
-- every studio reads the same official guide prices, so the shared org_id gate
-- cannot apply. What gates a read is the membership second factor on its own:
-- a request inside a real org context (`app.current_org_id` set AND the caller a
-- member of that org) sees the rows; outside one (no context, a forged
-- non-member context) it sees none.
--
-- SELECT ONLY. There is no INSERT, UPDATE or DELETE policy anywhere here, and
-- rls/roles.sql grants metra_app SELECT and nothing else on these tables, so a
-- write from the app is refused twice (42501 from the missing grant first). The
-- only writer is the owner's `market:publish` CLI, which runs as the BYPASSRLS
-- connection role: the same trust boundary as `db:migrate`.
--
-- WITHDRAWN DATA IS INVISIBLE. A withdrawn bulletin is not returned, and an
-- observation is visible only through a PUBLISHED bulletin, so a withdrawal
-- (`market:withdraw`) falls back to the previous bulletin's figures with no
-- deploy and no row deleted.

alter table public.market_categories enable row level security;
alter table public.market_categories force  row level security;
drop policy if exists market_read on public.market_categories;
create policy market_read on public.market_categories
  for select
  using (
    nullif(current_setting('app.current_org_id', true), '') is not null
    and public.app_is_current_org_member()
  );

alter table public.market_items enable row level security;
alter table public.market_items force  row level security;
drop policy if exists market_read on public.market_items;
create policy market_read on public.market_items
  for select
  using (
    nullif(current_setting('app.current_org_id', true), '') is not null
    and public.app_is_current_org_member()
  );

alter table public.market_bulletins enable row level security;
alter table public.market_bulletins force  row level security;
drop policy if exists market_read on public.market_bulletins;
create policy market_read on public.market_bulletins
  for select
  using (
    nullif(current_setting('app.current_org_id', true), '') is not null
    and public.app_is_current_org_member()
    and status = 'published'
  );

alter table public.market_price_observations enable row level security;
alter table public.market_price_observations force  row level security;
drop policy if exists market_read on public.market_price_observations;
create policy market_read on public.market_price_observations
  for select
  using (
    nullif(current_setting('app.current_org_id', true), '') is not null
    and public.app_is_current_org_member()
    and exists (
      select 1 from public.market_bulletins b
      where b.id = market_price_observations.bulletin_id
        and b.status = 'published'
    )
  );
