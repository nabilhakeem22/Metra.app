-- rls/functions/60-delivery-documents.sql — the client delivery portal: documents and comments.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- Client Deliverables Step 1 — resolve ONE released document of a delivery by its
-- share token, for the portal's download route. SECURITY DEFINER (the token IS the
-- authorization; no session, no org GUC), and the delivery is resolved SOLELY by
-- token_hash, exactly like app_delivery_by_token.
--
-- The client-supplied p_document_id is ONLY a FILTER inside a delivery that the
-- token already proved. It can never widen the search: the artifact must belong to
-- THAT delivery (a.engagement_id = de.id) and must be released (a.client_visible).
-- The storage location returned always comes from the `files` row joined in-org
-- (f.org_id = a.org_id) — never from anything the caller sent — so a forged or
-- borrowed uuid cannot address another tenant's object.
--
-- NO ORACLE: every failure mode returns the SAME null — a forged uuid, an artifact
-- belonging to another delivery or another org, an artifact the studio has not
-- released, an artifact with no file, and an unknown / revoked / expired token are
-- all indistinguishable to the caller.
--
-- SAFE BY CONSTRUCTION: this function selects ONLY files.bucket, files.object_key,
-- engagement_artifacts.kind and files.original_name. Every pricing/margin/internal
-- column of every table is simply never referenced (omission, not a filter) — the
-- AC4 test greps this function's source to enforce that.
create or replace function public.app_delivery_document_by_token(
  p_hash text,
  p_document_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bucket', f.bucket,
    'object_key', f.object_key,
    'kind', a.kind,
    'original_name', f.original_name,
    -- Step 3 — the ROUTE's authorization, not a hint: 'withheld' is refused with
    -- the same indistinguishable failure as a forged id, and 'preview' is served
    -- as a downscaled rendition with no download filename.
    'access', public.app_document_access(
      a.kind, public.app_document_settled(a.kind, de.id), f.original_name
    ),
    -- Round C (0058): image, pdf or other, by the SAME rule the portal
    -- snapshot's documents[].media reads, so a thumbnail and its bytes agree.
    'media', public.app_document_media(f.original_name)
  )
  from public.design_engagements de
  join public.engagement_artifacts a
    on a.engagement_id = de.id
   and a.org_id = de.org_id
   and a.client_visible
  join public.files f
    on f.id = a.file_id
   and f.org_id = a.org_id
  where de.token_hash = p_hash
    and (de.share_expires_at is null or de.share_expires_at > now())
    and a.id = p_document_id;
$$;

-- Round C (0058): the STUDIO LOGO for the client page, by share token.
-- SECURITY DEFINER (the token IS the authorization; no session, no org GUC),
-- resolved exactly like app_delivery_document_by_token: the delivery by
-- token_hash while the link is live, its organization, and the `files` row
-- organizations.logo_file_id points at, joined IN-ORG (f.org_id = de.org_id) so
-- a logo id can never address another tenant's object.
--
-- Returns { bucket, object_key } only when that file is an image
-- (app_document_media = 'image'): the route serves a downscaled rendition, and
-- Storage transforms images only. NO ORACLE: an unknown, revoked or expired
-- token, an org with no logo, a logo row in another org and a non-image logo all
-- return the same null. It selects files.bucket and files.object_key (and reads
-- original_name for the media test); no name, size, money or pricing column is
-- returned. Locked down right below, in this same transaction.
create or replace function public.app_delivery_logo_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('bucket', f.bucket, 'object_key', f.object_key)
  from public.design_engagements de
  join public.organizations o on o.id = de.org_id
  join public.files f on f.id = o.logo_file_id and f.org_id = de.org_id
  where de.token_hash = p_hash
    and (de.share_expires_at is null or de.share_expires_at > now())
    and public.app_document_media(f.original_name) = 'image';
$$;

-- Closed in the SAME implicit transaction as the CREATE above. A new function
-- is executable by PUBLIC (and, on Supabase, by the API roles through default
-- privileges) from the moment it exists; roles.sql revokes that too, but it
-- runs later, in its own transaction. This leaves no window. The metra_app
-- grant is guarded because on a fresh database roles.sql, which creates that
-- role, has not run yet.
revoke all on function public.app_delivery_logo_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_logo_by_token(text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_logo_by_token(text) to metra_app;
  end if;
end
$$;

-- Client Deliverables Step 2 — read ONE released document's comment thread by share
-- token. Same authorization shape as app_delivery_document_by_token: the token IS
-- the authorization, p_document_id is ONLY a filter inside the delivery the token
-- already proved (a.engagement_id = de.id), and the comments are bound to the
-- artifact in-org (dc.org_id = a.org_id), so a forged uuid cannot reach another
-- tenant's thread.
--
-- IDENTITY-BLIND ON THE STUDIO SIDE: a staff reply returns channel 'staff' and NO
-- name — the client sees "the studio", never which member wrote it, and this
-- function never joins users/memberships at all. Client messages return the name
-- the client themself typed. `author_ip` / `author_user_agent` are audit columns and
-- are never selected here.
--
-- NO ORACLE: an unknown/expired token, an unreleased document, a document in
-- another delivery and a document with no messages yet are all indistinguishable —
-- every one returns the same empty array.
--
-- BOUNDED: the 200 oldest messages. A thread is a conversation, not a feed; the cap
-- keeps one portal read from turning into an unbounded aggregate.
create or replace function public.app_delivery_document_comments_by_token(
  p_hash text,
  p_document_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(m order by m_sort), '[]'::jsonb)
  from (
    select dc.created_at as m_sort,
      jsonb_build_object(
        'id', dc.id,
        'channel', dc.author_channel,
        -- Staff replies are attributed to the studio, not to a named person.
        'author_name', case when dc.author_channel = 'client' then dc.author_name end,
        'body', dc.body,
        'created_at', dc.created_at
      ) as m
    from public.design_engagements de
    join public.engagement_artifacts a
      on a.engagement_id = de.id
     and a.org_id = de.org_id
     and a.client_visible
    join public.engagement_document_comments dc
      on dc.artifact_id = a.id
     and dc.org_id = a.org_id
    where de.token_hash = p_hash
      and (de.share_expires_at is null or de.share_expires_at > now())
      and a.id = p_document_id
    order by dc.created_at
    limit 200
  ) mx;
$$;

-- Client Deliverables Step 2 — APPEND one client message to a released document's
-- thread, by share token. The WRITABLE twin of the reader above, and it mirrors
-- app_delivery_respond_by_token: hash-resolved delivery, no session, no org GUC.
--
-- ADVISORY: this writes exactly one row into an append-only table. It moves NO
-- state, adds NO guard, opens NO change order, and touches NO money. A client who
-- comments has not requested a revision — the stage buttons remain the only way to
-- do that, deliberately, so a comment can never leave either side stuck.
--
-- NOT IDEMPOTENT, unlike the respond/claim SDFs: two identical messages are two
-- messages, because that is what a conversation is. The flood ceiling below is what
-- bounds abuse instead of a UNIQUE index.
--
-- FLOOD CEILING: at most 20 client messages per engagement per hour. This is the
-- backstop for an UNAUTHENTICATED write path — the edge rate-limit binding is the
-- first line, but it is per-IP and this is not. Exceeding it returns 'too_many',
-- which the portal shows as a plain "try again later", never as an error.
--
-- Round B (0056): a written message also refreshes design_engagements.updated_at.
-- Signature and return type are unchanged.
create or replace function public.app_delivery_comment_by_token(
  p_hash text,
  p_document_id uuid,
  p_body text,
  p_name text,
  p_ip text,
  p_ua text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_body  text;
  eid     uuid;
  oid     uuid;
  aid     uuid;
  st      text;
  exp     timestamptz;
  recent  bigint;
begin
  -- Trim/cap here too, not only in TS: this function is the trust boundary, and the
  -- table's CHECK would raise (a 500) rather than return a code on an empty body.
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return 'invalid'; end if;
  v_body := left(v_body, 2000);

  -- Resolve the delivery AND the document in one join, so a document belonging to
  -- another delivery is simply "not found" — same null as a forged token.
  select de.id, de.org_id, de.state, de.share_expires_at, a.id
    into eid, oid, st, exp, aid
    from public.design_engagements de
    join public.engagement_artifacts a
      on a.engagement_id = de.id
     and a.org_id = de.org_id
     and a.client_visible
    where de.token_hash = p_hash
      and a.id = p_document_id;
  if not found then return 'invalid'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;
  if st in ('closed_design_only', 'execution', 'abandoned') then
    return 'not_active';
  end if;

  select count(*) into recent
    from public.engagement_document_comments dc
    where dc.engagement_id = eid
      and dc.author_channel = 'client'
      and dc.created_at > now() - interval '1 hour';
  if recent >= 20 then return 'too_many'; end if;

  insert into public.engagement_document_comments (
    org_id, engagement_id, artifact_id, author_channel,
    author_name, author_ip, author_user_agent, body
  )
  values (
    oid, eid, aid, 'client',
    nullif(left(btrim(coalesce(p_name, '')), 120), ''),
    nullif(left(coalesce(p_ip, ''), 45), ''),
    nullif(left(coalesce(p_ua, ''), 512), ''),
    v_body
  );
  -- Round B: a client act refreshes the delivery's updated_at, so the studio's
  -- newest-first lists surface it (the same touch as the respond and claim
  -- functions in 50-delivery-write.sql).
  update public.design_engagements set updated_at = now() where id = eid;
  return 'ok';
end
$$;
