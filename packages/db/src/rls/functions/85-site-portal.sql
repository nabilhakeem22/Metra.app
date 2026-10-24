-- rls/functions/85-site-portal.sql: Stage 3, the site diary on the client's
-- delivery page (migration 0064): the studio-PUBLISHED site updates, by share
-- token.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- The client's site updates: SECURITY DEFINER, the token IS the authorization
-- (no session, no org GUC). The delivery is resolved SOLELY by token_hash while
-- the link is live, exactly like app_delivery_by_token, and only while it is in
-- `execution`. Its project's PUBLISHED visits are returned, newest day first,
-- `p_limit` DAYS per page (clamped to 1..14; null means 7), every published
-- visit of a returned day included, so the `p_before` date cursor never splits
-- a day. `next_before` is the oldest returned day when an older published day
-- exists, else null.
--
-- NULL, the same null, when: the token is unknown, revoked or expired; the
-- delivery is not in execution; the project has no published visit at all. A
-- `p_before` older than every published day answers an empty page, not null.
--
-- CLIENT-SAFE BY CONSTRUCTION (owner decision O4). Per visit: id, date,
-- published_at and the studio's two captions. Per photo (at most 20 per visit,
-- in the order taken): id, the two object keys, width and height, and only for
-- a photo the studio made client-visible, that is stored and not void. The
-- engineer, the check-in reading and its verdict, the notes and the deliveries
-- are never referenced (omission, not a filter); site-portal.dbtest.ts greps
-- this function's source and its output for them. The caller signs the object
-- keys server-side; they never reach the browser.
create or replace function public.app_delivery_site_updates_by_token(
  p_hash text,
  p_before date,
  p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with delivery as (
    select de.org_id, de.project_id
      from public.design_engagements de
     where de.token_hash = p_hash
       and (de.share_expires_at is null or de.share_expires_at > now())
       and de.state = 'execution'
       and exists (
         select 1 from public.site_visits v
          where v.org_id = de.org_id
            and v.project_id = de.project_id
            and v.published_at is not null
       )
  ),
  page_size as (
    select least(greatest(coalesce(p_limit, 7), 1), 14) as days
  ),
  candidate_days as (
    select distinct v.visit_date
      from delivery d
      join public.site_visits v
        on v.org_id = d.org_id
       and v.project_id = d.project_id
     where v.published_at is not null
       and (p_before is null or v.visit_date < p_before)
     order by v.visit_date desc
     limit (select days + 1 from page_size)
  ),
  shown_days as (
    select c.visit_date
      from candidate_days c
     order by c.visit_date desc
     limit (select days from page_size)
  ),
  shown_visits as (
    select v.org_id, v.id, v.visit_date, v.published_at, v.client_caption_ar, v.client_caption_en
      from delivery d
      join public.site_visits v
        on v.org_id = d.org_id
       and v.project_id = d.project_id
      join shown_days s on s.visit_date = v.visit_date
     where v.published_at is not null
  )
  select case when not exists (select 1 from delivery) then null else jsonb_build_object(
    'updates', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'visit_id', sv.id,
                 'date', sv.visit_date,
                 'published_at', sv.published_at,
                 'caption_ar', sv.client_caption_ar,
                 'caption_en', sv.client_caption_en,
                 'photos', coalesce((
                   select jsonb_agg(
                            jsonb_build_object(
                              'id', ph.id,
                              'display_key', ph.display_key,
                              'thumb_key', ph.thumb_key,
                              'width', ph.width,
                              'height', ph.height
                            )
                            order by ph.taken_at, ph.id
                          )
                     from (
                       select p.id, p.display_key, p.thumb_key, p.width, p.height, p.taken_at
                         from public.site_photos p
                        where p.org_id = sv.org_id
                          and p.visit_id = sv.id
                          and p.client_visible
                          and p.status = 'stored'
                          and p.voided_at is null
                        order by p.taken_at, p.id
                        limit 20
                     ) ph
                 ), '[]'::jsonb)
               )
               order by sv.visit_date desc, sv.published_at desc, sv.id desc
             )
        from shown_visits sv
    ), '[]'::jsonb),
    'next_before', case
      when (select count(*) from candidate_days) > (select days from page_size)
        then (select min(s.visit_date) from shown_days s)
    end
  ) end;
$$;

-- Same-transaction lockdown (new-function-lockdown.test.ts): a NEW function is
-- executable by PUBLIC from the moment CREATE commits, and roles.sql runs
-- several files later. The public path calls it through the base connection,
-- as its owner, so these revokes cannot break that path.
revoke all on function public.app_delivery_site_updates_by_token(text, date, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_delivery_site_updates_by_token(text, date, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_site_updates_by_token(text, date, integer) to metra_app;
  end if;
end
$$;
