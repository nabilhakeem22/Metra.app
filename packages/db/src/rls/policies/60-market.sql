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
-- WITHDRAWN DATA IS INVISIBLE. A withdrawn bulletin is not returned; an
-- observation and an item's per-bulletin details are visible only through a
-- PUBLISHED bulletin; and an ITEM is visible only while some published
-- bulletin prices it, so a wrong file's new names vanish with its withdrawal
-- (`market:withdraw`), which falls back to the previous bulletin with no
-- deploy and no row deleted. Categories stay visible: their names come from
-- the code (packages/market-ingest/src/taxonomy.ts), never from a file.
--
-- EVALUATED ONCE PER QUERY. The org-context test and the membership function
-- are wrapped in `(select ...)`, so the planner runs them as one InitPlan
-- instead of once per row (measured 7 to 14x slower unwrapped on the C4
-- series read; market-book-plans.dbtest.ts pins the plan shape).

alter table public.market_categories enable row level security;
alter table public.market_categories force  row level security;
drop policy if exists market_read on public.market_categories;
create policy market_read on public.market_categories
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
  );

alter table public.market_items enable row level security;
alter table public.market_items force  row level security;
drop policy if exists market_read on public.market_items;
create policy market_read on public.market_items
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
    and exists (
      select 1 from public.market_price_observations o
      join public.market_bulletins b on b.id = o.bulletin_id
      where o.item_id = market_items.id
        and b.status = 'published'
    )
  );

alter table public.market_bulletins enable row level security;
alter table public.market_bulletins force  row level security;
drop policy if exists market_read on public.market_bulletins;
create policy market_read on public.market_bulletins
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
    and status = 'published'
  );

alter table public.market_price_observations enable row level security;
alter table public.market_price_observations force  row level security;
drop policy if exists market_read on public.market_price_observations;
create policy market_read on public.market_price_observations
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
    and exists (
      select 1 from public.market_bulletins b
      where b.id = market_price_observations.bulletin_id
        and b.status = 'published'
    )
  );

alter table public.market_item_details enable row level security;
alter table public.market_item_details force  row level security;
drop policy if exists market_read on public.market_item_details;
create policy market_read on public.market_item_details
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
    and exists (
      select 1 from public.market_bulletins b
      where b.id = market_item_details.bulletin_id
        and b.status = 'published'
    )
  );

-- THE SEED BOOK (0062): every published item as a studio's price book would
-- receive it, rebuilt whole by market:publish, market:withdraw and
-- market:seed-price-books from the published rows only, so it carries no
-- withdrawn data of its own to hide. Read by the app's seed (a new studio at
-- sign-up, an empty book's button) inside the studio's org context.
alter table public.market_seed_book enable row level security;
alter table public.market_seed_book force  row level security;
drop policy if exists market_read on public.market_seed_book;
create policy market_read on public.market_seed_book
  for select
  using (
    (select nullif(current_setting('app.current_org_id', true), '')) is not null
    and (select public.app_is_current_org_member())
  );
