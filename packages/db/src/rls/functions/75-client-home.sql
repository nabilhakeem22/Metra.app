-- rls/functions/75-client-home.sql: client home DB step C. The client's ONE
-- page is the delivery link /d: its Execution tab reads the delivery's
-- execution facts, its contract and change orders through the functions
-- below, and the four client acts that bind the client (signing, a change
-- order decision, "I paid" on a payment request or a design instalment) need
-- a one-time code emailed to the client's address on file.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so the
-- internal helpers come first, and every callee in an earlier file. Idempotent
-- (`create or replace`), and every function is locked down right after its
-- CREATE (new-function-lockdown.test.ts). rls/**.sql is exempt from the
-- 150-line rule (stack-profile.md).
--
-- THE SAME DOCUMENTS AS /c AND /v, BY CONSTRUCTION. The home's contract and
-- change orders are app_contract_by_token / app_variation_by_token called with
-- the STORED token hash of the home's contract (app_delivery_execution_contract)
-- and its change orders, never a second copy of those builders: the JSON, and
-- so the digest a client signs, is identical on both pages.
--
-- THE CODES. The app makes the code and its challenge id, emails the code, and
-- passes only sha256(challengeId:code) here; the raw code never reaches the
-- database. A code is bound to (delivery, purpose, target), lives ten minutes,
-- allows five wrong tries and is used once: consumed in the same transaction
-- as the act it authorised, with the row that act wrote as its result_ref.
-- The issue limits are this file's (app_home_code_issue_by_token), so no
-- caller can raise them.
--
-- CLIENT-SAFE: no function here names a price-basis column of the studio. The
-- money basis the execution facts need (the CLIENT CHARGE rates the client
-- already sees on /c) comes through app_execution_flow_source
-- (functions/65-execution-facts.sql). The prosrc test (client-home.dbtest.ts)
-- holds every body here to the strict word list, comments included, so the
-- bodies carry no comment that could trip it.

-- INTERNAL: the delivery a share token names, and whether its link is live
-- (the share_expires_at rule of app_delivery_by_token). Every function below
-- resolves the token through it: the readers take only a live link, the acts
-- tell an expired link from an unknown one. Revoked from every caller role,
-- metra_app included. SECURITY INVOKER.
create or replace function public.app_home_delivery(p_hash text)
returns table (
  id uuid,
  org_id uuid,
  project_id uuid,
  client_id uuid,
  entry_phase text,
  state text,
  live boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select de.id, de.org_id, de.project_id, de.client_id, de.entry_phase, de.state::text,
         (de.share_expires_at is null or de.share_expires_at > now())
    from public.design_engagements de
   where de.token_hash = p_hash;
$$;

revoke all on function public.app_home_delivery(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_delivery(text) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: the execution contract of a LIVE home at `execution`
-- (app_delivery_execution_contract: issued, signed or terminated), with its
-- stored token hash. The readers below hand that hash to the /c functions.
-- Revoked from every caller role, metra_app included. SECURITY INVOKER.
create or replace function public.app_home_contract(p_hash text)
returns table (id uuid, org_id uuid, status text, token_hash text)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.org_id, c.status::text, c.token_hash
    from public.app_home_delivery(p_hash) d
    join public.contracts c
      on c.org_id = d.org_id
     and c.id = public.app_delivery_execution_contract(d.id, d.org_id)
   where d.live
     and d.state = 'execution';
$$;

revoke all on function public.app_home_contract(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_contract(text) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: the address a client's code goes to: the client's PRIMARY
-- contact's email, else the client's own, trimmed and lower-cased; null when
-- neither is set or neither looks like an address (one @, a dot in the
-- domain). The client never types it: a code sent where the client asks would
-- prove nothing. Revoked from every caller role, metra_app included.
-- SECURITY INVOKER.
create or replace function public.app_client_code_destination(p_org_id uuid, p_client_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select found.email
    from (
      select lower(coalesce(
        (select nullif(btrim(cc.email), '') from public.client_contacts cc
          where cc.org_id = p_org_id and cc.client_id = p_client_id and cc.is_primary
          limit 1),
        (select nullif(btrim(c.email), '') from public.clients c
          where c.org_id = p_org_id and c.id = p_client_id)
      )) as email
    ) found
   where found.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$';
$$;

revoke all on function public.app_client_code_destination(uuid, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_client_code_destination(uuid, uuid) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: what the client is shown of that address: its first letter, the
-- first letter of the domain and the top-level domain, `n•••@g•••.com`, at
-- most 80 characters. Pure. Revoked from every caller role, metra_app
-- included.
create or replace function public.app_email_hint(p_email text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select left(
    left(split_part(p_email, '@', 1), 1) || '•••@'
      || left(split_part(p_email, '@', 2), 1) || '•••.'
      || regexp_replace(split_part(p_email, '@', 2), '^.*\.', ''),
    80
  );
$$;

revoke all on function public.app_email_hint(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_email_hint(text) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: check one code against the challenge it was sent for. Answers, in
-- this order:
--   code_unknown   no such challenge for THIS delivery, purpose and target (a
--                  code of another act, another target or another delivery
--                  is unknown here, never a hint that it exists elsewhere)
--   code_used      already consumed by its act
--   code_locked    five wrong tries on this code, or 15 on its target in the
--                  last day over all its codes (H3 security S5: guessing
--                  across fresh codes stops there): even the right code is
--                  refused
--   code_expired   past its ten minutes
--   code_wrong:N   the hash differs; the try is counted, N tries are left (on
--                  this code, or on the target's day if that ends first)
--   ok             the act may run
-- LOCKS: an advisory lock per (delivery, purpose, target) first, so the
-- target's tries of the day are counted one check at a time, then the
-- challenge row (two submissions of one code meet here: the second reads it
-- consumed). Only the act wrappers below take that advisory lock, always
-- first, so it orders nothing against a studio writer.
-- Revoked from every caller role, metra_app included. SECURITY INVOKER.
create or replace function public.app_client_code_check(
  p_engagement_id uuid,
  p_org_id uuid,
  p_challenge_id uuid,
  p_purpose text,
  p_target text,
  p_code_hash text
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_code         public.client_verification_codes%rowtype;
  v_target_tries integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(':', 'client-code-target', p_engagement_id, p_purpose, p_target), 0)
  );
  select * into v_code
    from public.client_verification_codes c
   where c.org_id = p_org_id
     and c.id = p_challenge_id
     and c.engagement_id = p_engagement_id
     and c.purpose = p_purpose
     and c.target_key = p_target
   for update;
  if not found then return 'code_unknown'; end if;
  if v_code.consumed_at is not null then return 'code_used'; end if;
  if v_code.attempts >= 5 then return 'code_locked'; end if;
  select coalesce(sum(c.attempts), 0) into v_target_tries
    from public.client_verification_codes c
   where c.org_id = p_org_id
     and c.engagement_id = p_engagement_id
     and c.purpose = p_purpose
     and c.target_key = p_target
     and c.created_at > now() - interval '1 day';
  if v_target_tries >= 15 then return 'code_locked'; end if;
  if v_code.expires_at <= now() then return 'code_expired'; end if;
  if v_code.code_hash is distinct from p_code_hash then
    update public.client_verification_codes
       set attempts = attempts + 1, updated_at = now()
     where id = v_code.id;
    return 'code_wrong:' || least(4 - v_code.attempts, 14 - v_target_tries)::text;
  end if;
  return 'ok';
end
$$;

revoke all on function public.app_client_code_check(uuid, uuid, uuid, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_client_code_check(uuid, uuid, uuid, text, text, text) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: the answer an act wrapper gives for a code app_client_code_check
-- refused: {code} and, for a wrong code, {attempts_left}. Pure. Revoked from
-- every caller role, metra_app included.
create or replace function public.app_client_code_refusal(p_check text)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_check like 'code_wrong:%'
      then jsonb_build_object('code', 'code_wrong', 'attempts_left', split_part(p_check, ':', 2)::int)
    else jsonb_build_object('code', p_check)
  end;
$$;

revoke all on function public.app_client_code_refusal(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_client_code_refusal(text) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: mark a checked code used by the row its act wrote, the act's own
-- evidence. Called only on `ok`: a code whose act answered anything else
-- authorised nothing and names nothing, so it is left to expire (H3 functional
-- F8, reliability note 1). Once only (the guard trigger refuses a second
-- consumption); a null ref fails the consumed_pair CHECK (23514) rather than
-- consume nothing in silence. Revoked from every caller role, metra_app
-- included. SECURITY INVOKER.
create or replace function public.app_client_code_consume(p_challenge_id uuid, p_result_ref uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.client_verification_codes
     set consumed_at = now(), result_ref = p_result_ref, updated_at = now()
   where id = p_challenge_id
     and consumed_at is null;
$$;

revoke all on function public.app_client_code_consume(uuid, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_client_code_consume(uuid, uuid) from %I', r);
    end if;
  end loop;
end
$$;

-- A code row is EVIDENCE of a client act. On UPDATE exactly one of:
--   * a wrong try: `attempts` goes up by exactly one;
--   * the consumption: `consumed_at` and `result_ref` go from null to set,
--     together, once;
-- with `updated_at`, and nothing else, also changing. A consumed row is
-- frozen. A DELETE raises MT100 too, unless it is
--   * the delivery's own cascade (`pg_trigger_depth() > 1`: a referential
--     action reaches this BEFORE DELETE from inside the parent's RI trigger, a
--     direct DELETE at depth 1, the fence enforce_immutable_when uses), or
--   * the purge of a code that expired more than 90 days ago (H3 reliability
--     R5: app_home_code_issue_by_token removes a few with each code it makes;
--     the act a used code authorised keeps its own evidence row).
-- Attached by policies/36-client-home.sql. NOT security definer.
-- `set search_path = ''`.
create or replace function public.enforce_client_code_guarded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if pg_trigger_depth() > 1 or OLD.expires_at < now() - interval '90 days' then return OLD; end if;
    raise exception 'a client verification code is deleted only with its delivery or 90 days after it expired (challenge %)', OLD.id
      using errcode = 'MT100';
  end if;

  if OLD.consumed_at is null
     and (to_jsonb(NEW) - 'attempts' - 'consumed_at' - 'result_ref' - 'updated_at')
       = (to_jsonb(OLD) - 'attempts' - 'consumed_at' - 'result_ref' - 'updated_at')
     and (
       (NEW.attempts = OLD.attempts + 1 and NEW.consumed_at is null and NEW.result_ref is null)
       or (NEW.attempts = OLD.attempts and NEW.consumed_at is not null and NEW.result_ref is not null)
     ) then
    return NEW;
  end if;

  raise exception
    'a client verification code changes only by one wrong try or its one consumption (challenge %)', OLD.id
    using errcode = 'MT100';
end
$$;

revoke all on function public.enforce_client_code_guarded() from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.enforce_client_code_guarded() from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.enforce_client_code_guarded() to metra_app;
  end if;
end
$$;

-- INTERNAL: when a contract was terminated, from its `terminated` event (the
-- contract row keeps no such column); null for a contract never terminated.
-- Revoked from every caller role, metra_app included: it takes bare ids.
-- SECURITY INVOKER.
create or replace function public.app_contract_terminated_at(p_org_id uuid, p_contract_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select e.decided_at
    from public.contract_events e
   where e.org_id = p_org_id and e.contract_id = p_contract_id and e.kind = 'terminated'
   order by e.decided_at desc, e.id desc
   limit 1;
$$;

revoke all on function public.app_contract_terminated_at(uuid, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_terminated_at(uuid, uuid) from %I', r);
    end if;
  end loop;
end
$$;

-- INTERNAL: app_execution_flow_source as the CLIENT may hold it, evaluated
-- once (H3 reliability R2). Two differences from the studio's:
--   * a draft contract (the studio's working copy) is null;
--   * money.open_variations counts the change orders the client can see
--     (issued, the link live or expired) plus AT MOST ONE for any the studio
--     approved internally and has not issued (H3 security S4): the count is
--     the client's, and the stage still waits on an open change order before
--     it says "settled", so both sides stand on the same step.
-- issued_boq_id and measured_works stay: the client's projection needs them
-- (whether a BOQ is issued, and the full balance that tells the final account
-- from settled). Revoked from every caller role, metra_app included: it takes
-- a bare id. SECURITY INVOKER.
create or replace function public.app_home_flow_source(p_engagement_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with source as materialized (
    select public.app_execution_flow_source(p_engagement_id) as facts
  ),
  money as materialized (
    select (s.facts #>> '{contract,money,open_variations}')::int as open,
           (s.facts #>> '{contract,money,issued_variations}')::int
             + (s.facts #>> '{contract,money,expired_variations}')::int as seen
      from source s
  )
  select case
    when s.facts -> 'contract' ->> 'status' = 'draft'
      then jsonb_set(s.facts, '{contract}', 'null'::jsonb)
    when m.open is not null
      then jsonb_set(s.facts, '{contract,money,open_variations}', to_jsonb(m.seen + (m.open > m.seen)::int))
    else s.facts
  end
  from source s, money m;
$$;

revoke all on function public.app_home_flow_source(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_flow_source(uuid) from %I', r);
    end if;
  end loop;
end
$$;

-- Public share: the client home, by the delivery's token hash. SECURITY
-- DEFINER (the token IS the authorization). NULL, uniformly, unless the link
-- is live: an unknown, revoked or expired link, a light delivery's included,
-- all look the same. Otherwise:
--   delivery      {number, year (its creation year in Cairo, the DE-YYYY-NNNN
--                 year), title_ar, title_en, entry_phase, phase ('design',
--                 'execution', or 'closed' once abandoned or closed after the
--                 design), created_at}
--   firm          {name_ar, name_en, logo_file_id, phone, whatsapp}: the five
--                 keys of app_delivery_by_token's firm, equal for one token
--   client        {name_ar, name_en}
--   code_channel  {hint} of the address a code would go to, or null when the
--                 client has none: no code can be sent, and the page says so
--   execution     null unless the delivery is at `execution`, else
--     contract     the home's execution contract (app_delivery_execution_
--                  contract) {id, number, year (creation, Cairo), status,
--                  signing_open (issued, its online window still open),
--                  signed (app_contract_signed), terminated_at (app_contract_
--                  terminated_at, null unless terminated), end_date
--                  (YYYY-MM-DD), time_extension_days_total}, or null
--     previous_contract  {status: 'terminated', terminated_at} of the newest
--                  terminated contract the delivery owns that is not the one
--                  above (a terminated contract that a newer issued BOQ, a
--                  draft or a new contract stands in front of), or null
--     flow_source  app_home_flow_source: the studio's own fact source as the
--                  client may hold it (a draft masked, the open change orders
--                  counted as the client sees them)
--     money        app_delivery_execution_by_token, the execution card
-- Every helper is evaluated ONCE per call (each in a materialized CTE; H3
-- reliability R2): the fact source and the address are the costly ones.
create or replace function public.app_home_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with home as materialized (
    select d.id, d.org_id, d.client_id, d.entry_phase, d.state
      from public.app_home_delivery(p_hash) d
     where d.live
  ),
  contract as materialized (
    select c.id, c.org_id, c.number, c.created_at, c.status, c.end_date, c.share_expires_at
      from home h
      join public.contracts c
        on c.org_id = h.org_id
       and c.id = public.app_delivery_execution_contract(h.id, h.org_id)
     where h.state = 'execution'
  ),
  previous as materialized (
    select c.id, c.org_id
      from home h
     cross join lateral public.app_delivery_boqs(h.id, h.org_id) b
      join public.contracts c on c.org_id = h.org_id and c.source_boq_id = b.id
     where h.state = 'execution'
       and c.status = 'terminated'
       and c.id is distinct from (select k.id from contract k)
     order by c.created_at desc, c.id desc
     limit 1
  ),
  address as materialized (
    select public.app_client_code_destination(h.org_id, h.client_id) as email from home h
  ),
  flow as materialized (
    select public.app_home_flow_source(h.id) as source from home h where h.state = 'execution'
  )
  select jsonb_build_object(
    'delivery', jsonb_build_object(
      'number', de.number,
      'year', extract(year from de.created_at at time zone 'Africa/Cairo')::int,
      'title_ar', de.title_ar,
      'title_en', de.title_en,
      'entry_phase', de.entry_phase,
      'phase', case
        when h.state = 'execution' then 'execution'
        when h.state in ('abandoned', 'closed_design_only') then 'closed'
        else 'design'
      end,
      'created_at', de.created_at
    ),
    'firm', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id,
      'phone', o.studio_phone,
      'whatsapp', o.studio_whatsapp
    ),
    'client', jsonb_build_object('name_ar', cl.name_ar, 'name_en', cl.name_en),
    'code_channel', (
      select jsonb_build_object('hint', public.app_email_hint(a.email)) from address a where a.email is not null
    ),
    'execution', case when h.state = 'execution' then jsonb_build_object(
      'contract', (
        select jsonb_build_object(
          'id', k.id,
          'number', k.number,
          'year', extract(year from k.created_at at time zone 'Africa/Cairo')::int,
          'status', k.status,
          'signing_open', k.status = 'issued' and (k.share_expires_at is null or k.share_expires_at > now()),
          'signed', public.app_contract_signed(k.org_id, k.id),
          'terminated_at', public.app_contract_terminated_at(k.org_id, k.id),
          'end_date', to_char(k.end_date, 'YYYY-MM-DD'),
          'time_extension_days_total', public.app_contract_time_extension_days(k.org_id, k.id)
        )
        from contract k
      ),
      'previous_contract', (
        select jsonb_build_object('status', 'terminated', 'terminated_at', public.app_contract_terminated_at(p.org_id, p.id))
          from previous p
      ),
      'flow_source', (select f.source from flow f),
      'money', public.app_delivery_execution_by_token(p_hash)
    ) end
  )
  from home h
  join public.design_engagements de on de.id = h.id
  join public.organizations o on o.id = h.org_id
  join public.clients cl on cl.org_id = h.org_id and cl.id = h.client_id;
$$;

revoke all on function public.app_home_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_by_token(text) to metra_app;
  end if;
end
$$;

-- Public share: the home's execution contract as /c shows it, while it is
-- issued or signed: app_contract_by_token with the contract's stored hash, so
-- the JSON (and the digest the client signs) is /c's byte for byte. NULL for
-- a link that is not live, a delivery not at `execution`, or no such
-- contract.
create or replace function public.app_home_contract_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_contract_by_token(k.token_hash)
    from public.app_home_contract(p_hash) k
   where k.status in ('issued', 'signed');
$$;

revoke all on function public.app_home_contract_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_contract_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_contract_by_token(text) to metra_app;
  end if;
end
$$;

-- Public share: the home contract's sections past the snapshot's first 50, 50
-- at a time: app_contract_sections_by_token with the stored hash. NULL as
-- app_home_contract_by_token.
create or replace function public.app_home_contract_sections_by_token(p_hash text, p_offset integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_contract_sections_by_token(k.token_hash, p_offset)
    from public.app_home_contract(p_hash) k
   where k.status in ('issued', 'signed');
$$;

revoke all on function public.app_home_contract_sections_by_token(text, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_contract_sections_by_token(text, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_contract_sections_by_token(text, integer) to metra_app;
  end if;
end
$$;

-- Public share: one section's lines of the home contract, 100 at a time:
-- app_contract_section_lines_by_token with the stored hash, so a section of
-- another contract answers NULL there too.
create or replace function public.app_home_contract_section_lines_by_token(
  p_hash text,
  p_section_id uuid,
  p_offset integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_contract_section_lines_by_token(k.token_hash, p_section_id, p_offset)
    from public.app_home_contract(p_hash) k
   where k.status in ('issued', 'signed');
$$;

revoke all on function public.app_home_contract_section_lines_by_token(text, uuid, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_contract_section_lines_by_token(text, uuid, integer) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_contract_section_lines_by_token(text, uuid, integer) to metra_app;
  end if;
end
$$;

-- Public share: the home contract's change orders. NULL as
-- app_home_contract_by_token (a terminated contract still answers: its
-- decided change orders are the record). Otherwise:
--   open     the newest 10 change orders the client can decide NOW: issued,
--            the link live (H3 functional F4: so the count of the facts,
--            issued_variations, is this list's length while under 10), each
--            app_variation_by_token with its stored hash (the /v document)
--   expired  the newest 10 issued ones whose link has lapsed, the same
--            document: the client can no longer answer them online
--   decided  the newest 20 approved or rejected ones that were put to the
--            client (an `issued` event; H3 functional F3: one the studio
--            approved internally and the termination then rejected was never
--            the client's), {id, number, year (creation, Cairo, the
--            VO-YYYY-NNNN year), status, net_delta (a scale-4 string),
--            decided_on (the decision's day in Cairo)}
create or replace function public.app_home_variations_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with home_contract as materialized (
    select k.id, k.org_id from public.app_home_contract(p_hash) k
  ),
  issued_orders as materialized (
    select v.token_hash, v.created_at, v.id, (v.share_expires_at is null or v.share_expires_at > now()) as live
      from home_contract k
      join public.variation_orders v on v.org_id = k.org_id and v.contract_id = k.id
     where v.status = 'issued' and v.token_hash is not null
  ),
  open_orders as materialized (
    select o.token_hash, o.created_at, o.id from issued_orders o where o.live
     order by o.created_at desc, o.id desc
     limit 10
  ),
  expired_orders as materialized (
    select o.token_hash, o.created_at, o.id from issued_orders o where not o.live
     order by o.created_at desc, o.id desc
     limit 10
  ),
  decided_orders as materialized (
    select v.id, v.number, v.created_at, v.status, v.net_delta, decision.decided_at
      from home_contract k
      join public.variation_orders v on v.org_id = k.org_id and v.contract_id = k.id
      cross join lateral (
        select e.decided_at from public.variation_order_events e
         where e.org_id = v.org_id and e.variation_order_id = v.id and e.kind in ('approved', 'rejected')
         order by e.decided_at desc, e.id desc
         limit 1
      ) decision
     where v.status in ('approved', 'rejected')
       and exists (
         select 1 from public.variation_order_events e
          where e.org_id = v.org_id and e.variation_order_id = v.id and e.kind = 'issued'
       )
     order by decision.decided_at desc, v.id desc
     limit 20
  )
  select jsonb_build_object(
    'open', coalesce((
      select jsonb_agg(public.app_variation_by_token(o.token_hash) order by o.created_at desc, o.id desc)
        from open_orders o
    ), '[]'::jsonb),
    'expired', coalesce((
      select jsonb_agg(public.app_variation_by_token(x.token_hash) order by x.created_at desc, x.id desc)
        from expired_orders x
    ), '[]'::jsonb),
    'decided', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'number', d.number,
          'year', extract(year from d.created_at at time zone 'Africa/Cairo')::int,
          'status', d.status,
          'net_delta', d.net_delta::text,
          'decided_on', to_char(d.decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD')
        ) order by d.decided_at desc, d.id desc
      )
      from decided_orders d
    ), '[]'::jsonb)
  )
  from home_contract;
$$;

revoke all on function public.app_home_variations_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_home_variations_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_variations_by_token(text) to metra_app;
  end if;
end
$$;

-- Public share: a one-time code for ONE act on the home, by the delivery's
-- token hash. SECURITY DEFINER (the token IS the authorization). The app made
-- the challenge id and the code, and passes sha256(challengeId:code) only.
-- Answers {status, ...}:
--   invalid        no delivery has this token hash
--   expired        the link's share_expires_at has passed
--   not_available  the act cannot be taken NOW, so no code is made: the
--                  purpose is unknown, or its target is not
--                    sign_contract         the home contract, issued, its online
--                                          signing window open;
--                    decide_variation      an issued change order of the home
--                                          contract, its link live, the
--                                          contract issued or signed;
--                    claim_request         a payment request of the home
--                                          contract with something due
--                                          (app_payment_request_due) and no
--                                          pending claim;
--                    claim_design_payment  a design-fee milestone kind with
--                                          something due (app_engagement_
--                                          milestone_due), no pending claim,
--                                          the delivery still in design
--   no_channel     the client has no address on file (app_client_code_destination)
--   busy           a studio write has held the delivery (or the studio) row
--                  for the whole 4 s wait: nothing is written, ask again
--   too_many       a limit is reached, with retry_after_seconds: 60 s between
--                  codes for one target; 5 per target an hour; 15 wrong tries
--                  on a target in a day (app_client_code_check); 10 per
--                  delivery an hour; 20 per delivery a day; 25 per studio a
--                  day (H3 security S1: no studio spends the platform's
--                  share); 80 a day across the platform (the email
--                  provider's free day is 100, shared). The wait is the
--                  studio's own unless only the platform's cap is reached
--   ok             the row is written; {email (for the server's send only,
--                  never the browser), hint, resend_after_seconds: 60}
-- No row is written unless the answer is ok. A malformed challenge id or code
-- hash is the server's bug and raises 22023 (a hash) or 23502 (no id).
--
-- LOCKS, in this order, so that NO advisory lock is ever held while a row lock
-- is waited for (H3 reliability R1: one studio's held row stalled every
-- studio's codes):
--   1. the delivery's and the studio's rows FOR KEY SHARE, the locks the new
--      row's foreign keys take: a studio transaction holding one FOR UPDATE
--      delays this studio's request only, and past 4 s it answers `busy`;
--   2. a purge of at most 50 codes that expired more than 90 days ago (H3
--      reliability R5; `skip locked`, so it waits on nothing);
--   3. an advisory lock per STUDIO: its limits are counted one issue at a time;
--   4. an advisory lock for the PLATFORM, last and held for one count and one
--      insert, which wait on nothing.
create or replace function public.app_home_code_issue_by_token(
  p_hash text,
  p_challenge_id uuid,
  p_purpose text,
  p_target text,
  p_code_hash text,
  p_ip text,
  p_ua text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_home        record;
  v_contract_id uuid;
  v_actionable  boolean;
  v_email       text;
  v_wait        integer;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'the code hash must be 64 lower-case hex characters' using errcode = '22023';
  end if;

  select d.* into v_home from public.app_home_delivery(p_hash) d;
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if not v_home.live then return jsonb_build_object('status', 'expired'); end if;
  if p_target is null or char_length(p_target) not between 1 and 64 then
    return jsonb_build_object('status', 'not_available');
  end if;

  if v_home.state = 'execution' then
    v_contract_id := public.app_delivery_execution_contract(v_home.id, v_home.org_id);
  end if;

  v_actionable := case p_purpose
    when 'sign_contract' then exists (
      select 1 from public.contracts c
       where c.org_id = v_home.org_id and c.id = v_contract_id and c.id::text = p_target
         and c.status = 'issued' and (c.share_expires_at is null or c.share_expires_at > now())
    )
    when 'decide_variation' then exists (
      select 1 from public.variation_orders v
        join public.contracts c on c.org_id = v.org_id and c.id = v.contract_id
       where v.org_id = v_home.org_id and v.contract_id = v_contract_id and v.id::text = p_target
         and v.status = 'issued' and v.token_hash is not null
         and (v.share_expires_at is null or v.share_expires_at > now())
         and c.status in ('issued', 'signed')
    )
    when 'claim_request' then exists (
      select 1 from public.payment_requests r
       where r.org_id = v_home.org_id and r.contract_id = v_contract_id and r.id::text = p_target
         and public.app_payment_request_due(r.org_id, r.id) > 0
         and not exists (
           select 1 from public.contract_payment_claims pc
            where pc.org_id = r.org_id and pc.request_id = r.id and pc.status = 'pending'
         )
    )
    when 'claim_design_payment' then
      v_home.state not in ('closed_design_only', 'execution', 'abandoned')
      and coalesce(public.app_engagement_milestone_due(v_home.id, p_target) > 0, false)
      and not exists (
        select 1 from public.client_payment_claims pc
         where pc.org_id = v_home.org_id and pc.engagement_id = v_home.id
           and pc.milestone_kind::text = p_target and pc.status = 'pending'
      )
    else false
  end;
  if not v_actionable then return jsonb_build_object('status', 'not_available'); end if;

  v_email := public.app_client_code_destination(v_home.org_id, v_home.client_id);
  if v_email is null then return jsonb_build_object('status', 'no_channel'); end if;

  begin
    perform 1 from public.design_engagements de where de.id = v_home.id for key share;
    perform 1 from public.organizations o where o.id = v_home.org_id for key share;
  exception when lock_not_available then
    return jsonb_build_object('status', 'busy');
  end;

  delete from public.client_verification_codes x
   where x.id in (
     select p.id from public.client_verification_codes p
      where p.created_at < now() - interval '90 days'
        and p.expires_at < now() - interval '90 days'
      order by p.created_at
      limit 50
      for update skip locked
   );

  perform pg_advisory_xact_lock(hashtextextended('client-verification-codes:' || v_home.org_id::text, 0));

  with mine as (
    select c.created_at, c.purpose, c.target_key, c.attempts
      from public.client_verification_codes c
     where c.org_id = v_home.org_id
       and c.engagement_id = v_home.id
       and c.created_at > now() - interval '1 day'
  )
  select greatest(
    (select ceil(extract(epoch from max(m.created_at) + interval '60 seconds' - now()))
       from mine m where m.purpose = p_purpose and m.target_key = p_target
     having max(m.created_at) > now() - interval '60 seconds'),
    (select ceil(extract(epoch from min(m.created_at) + interval '1 hour' - now()))
       from mine m where m.purpose = p_purpose and m.target_key = p_target and m.created_at > now() - interval '1 hour'
     having count(*) >= 5),
    (select ceil(extract(epoch from min(m.created_at) filter (where m.attempts > 0) + interval '1 day' - now()))
       from mine m where m.purpose = p_purpose and m.target_key = p_target
     having sum(m.attempts) >= 15),
    (select ceil(extract(epoch from min(m.created_at) + interval '1 hour' - now()))
       from mine m where m.created_at > now() - interval '1 hour'
     having count(*) >= 10),
    (select ceil(extract(epoch from min(m.created_at) + interval '1 day' - now()))
       from mine m
     having count(*) >= 20),
    (select ceil(extract(epoch from min(o.created_at) + interval '1 day' - now()))
       from public.client_verification_codes o
      where o.org_id = v_home.org_id and o.created_at > now() - interval '1 day'
     having count(*) >= 25)
  )::integer
    into v_wait;
  if v_wait is not null then
    return jsonb_build_object('status', 'too_many', 'retry_after_seconds', greatest(v_wait, 1));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-verification-codes', 0));

  select ceil(extract(epoch from min(p.created_at) + interval '1 day' - now()))::integer
    into v_wait
    from public.client_verification_codes p
   where p.created_at > now() - interval '1 day'
  having count(*) >= 80;
  if v_wait is not null then
    return jsonb_build_object('status', 'too_many', 'retry_after_seconds', greatest(v_wait, 1));
  end if;

  insert into public.client_verification_codes
    (id, org_id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash,
     expires_at, actor_ip, actor_user_agent)
  values (
    p_challenge_id, v_home.org_id, v_home.id, p_purpose, p_target,
    encode(sha256(convert_to(v_email, 'UTF8')), 'hex'), public.app_email_hint(v_email), p_code_hash,
    now() + interval '10 minutes',
    nullif(left(coalesce(p_ip, ''), 45), ''),
    nullif(left(coalesce(p_ua, ''), 512), '')
  );

  return jsonb_build_object(
    'status', 'ok',
    'email', v_email,
    'hint', public.app_email_hint(v_email),
    'resend_after_seconds', 60
  );
end
$$;

revoke all on function public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_code_issue_by_token(text, uuid, text, text, text, text, text) to metra_app;
  end if;
end
$$;

-- THE FOUR ACTS. Each is SECURITY DEFINER (the token IS the authorization),
-- waits at most 4 s on any lock, and answers jsonb {code, attempts_left?}:
--   invalid        no delivery has this token hash
--   token_expired  the home link has expired
--   not_active     the delivery is not at the stage the act belongs to
--   wrong_target   the contract, change order or request is not the home's
--                  (checked before the code, so a forged id costs no try)
--   code_unknown | code_used | code_locked | code_expired | code_wrong (with
--                  attempts_left): app_client_code_check's refusals
--   otherwise      the inner act's own answer, with ONE meaning per code (H3
--                  functional F1, F2):
--     ok                 the act is done
--     already            the same act is done already: the contract IS
--                        signed (online or on paper), the change order is
--                        decided, the claim is pending
--     contract_inactive  the contract is not open to the act: terminated, or
--                        no longer the home's contract
--     signing_closed     the contract's online signing window has closed
--     link_expired       the change order's own link has lapsed
--     not_active | wrong_state | invalid | busy  as the inner act says them
-- After the check, `app.client_code_verified` is set to 'on' for the inner
-- call only, and back to 'off' at once, transaction-local (the flag DB step C2
-- will make the inner functions ask for). ONLY on `ok` is the code consumed,
-- in the same transaction, by the row the act wrote: a code whose act
-- answered anything else authorised nothing and stays unused (reliability
-- note 1, functional F8).

-- Sign the home's execution contract: app_contract_ack_by_token with the
-- contract's stored hash. p_pdf_hash is what the app computed over
-- app_home_contract_by_token, which is /c's document. The target is any
-- contract on a BOQ the delivery owns; one that is not the home's contract
-- now (a newer BOQ or contract replaced it) is `contract_inactive`. The inner
-- act's `already` says only that the contract is no longer issued, so it is
-- read again here: `already` if signed, `contract_inactive` otherwise.
create or replace function public.app_home_contract_ack_by_token(
  p_hash text,
  p_contract_id uuid,
  p_challenge_id uuid,
  p_code_hash text,
  p_name text,
  p_ip text,
  p_ua text,
  p_pdf_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_home       record;
  v_contract   record;
  v_check      text;
  v_answer     text;
  v_result_ref uuid;
begin
  select d.* into v_home from public.app_home_delivery(p_hash) d;
  if not found then return jsonb_build_object('code', 'invalid'); end if;
  if not v_home.live then return jsonb_build_object('code', 'token_expired'); end if;
  if v_home.state <> 'execution' then return jsonb_build_object('code', 'not_active'); end if;

  select c.id, c.token_hash into v_contract
    from public.contracts c
   where c.org_id = v_home.org_id
     and c.id = p_contract_id
     and c.source_boq_id in (select b.id from public.app_delivery_boqs(v_home.id, v_home.org_id) b);
  if not found then return jsonb_build_object('code', 'wrong_target'); end if;

  v_check := public.app_client_code_check(
    v_home.id, v_home.org_id, p_challenge_id, 'sign_contract', p_contract_id::text, p_code_hash
  );
  if v_check <> 'ok' then return public.app_client_code_refusal(v_check); end if;
  if v_contract.id is distinct from public.app_delivery_execution_contract(v_home.id, v_home.org_id) then
    return jsonb_build_object('code', 'contract_inactive');
  end if;

  perform set_config('app.client_code_verified', 'on', true);
  v_answer := public.app_contract_ack_by_token(v_contract.token_hash, p_name, p_ip, p_ua, p_pdf_hash);
  perform set_config('app.client_code_verified', 'off', true);

  if v_answer = 'ok' then
    select e.id into v_result_ref
      from public.contract_events e
     where e.org_id = v_home.org_id and e.contract_id = v_contract.id and e.kind = 'acknowledged'
     order by e.decided_at desc, e.id desc
     limit 1;
    perform public.app_client_code_consume(p_challenge_id, v_result_ref);
  end if;
  return jsonb_build_object('code', case v_answer
    when 'already' then (
      select case when c.status = 'signed' then 'already' else 'contract_inactive' end
        from public.contracts c
       where c.org_id = v_home.org_id and c.id = v_contract.id
    )
    when 'expired' then 'signing_closed'
    else v_answer
  end);
end
$$;

revoke all on function public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_contract_ack_by_token(text, uuid, uuid, text, text, text, text, text) to metra_app;
  end if;
end
$$;

-- Approve or reject one change order of the home's contract:
-- app_variation_respond_by_token with the change order's stored hash. An
-- unknown decision answers `invalid` before the code is checked. The target is
-- a change order of any contract on a BOQ the delivery owns, so one of a
-- terminated contract answers the inner act's `contract_inactive`.
create or replace function public.app_home_variation_respond_by_token(
  p_hash text,
  p_variation_id uuid,
  p_decision text,
  p_challenge_id uuid,
  p_code_hash text,
  p_name text,
  p_ip text,
  p_ua text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_home       record;
  v_variation  record;
  v_check      text;
  v_answer     text;
  v_result_ref uuid;
begin
  select d.* into v_home from public.app_home_delivery(p_hash) d;
  if not found then return jsonb_build_object('code', 'invalid'); end if;
  if not v_home.live then return jsonb_build_object('code', 'token_expired'); end if;
  if v_home.state <> 'execution' then return jsonb_build_object('code', 'not_active'); end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    return jsonb_build_object('code', 'invalid');
  end if;

  select v.id, v.token_hash into v_variation
    from public.variation_orders v
    join public.contracts c on c.org_id = v.org_id and c.id = v.contract_id
   where v.org_id = v_home.org_id
     and v.id = p_variation_id
     and v.token_hash is not null
     and c.source_boq_id in (select b.id from public.app_delivery_boqs(v_home.id, v_home.org_id) b);
  if not found then return jsonb_build_object('code', 'wrong_target'); end if;

  v_check := public.app_client_code_check(
    v_home.id, v_home.org_id, p_challenge_id, 'decide_variation', p_variation_id::text, p_code_hash
  );
  if v_check <> 'ok' then return public.app_client_code_refusal(v_check); end if;

  perform set_config('app.client_code_verified', 'on', true);
  v_answer := public.app_variation_respond_by_token(v_variation.token_hash, p_decision, p_name, p_ip, p_ua);
  perform set_config('app.client_code_verified', 'off', true);

  if v_answer = 'ok' then
    select e.id into v_result_ref
      from public.variation_order_events e
     where e.org_id = v_home.org_id and e.variation_order_id = v_variation.id
       and e.kind in ('approved', 'rejected')
     order by e.decided_at desc, e.id desc
     limit 1;
    perform public.app_client_code_consume(p_challenge_id, v_result_ref);
  end if;
  return jsonb_build_object('code', case v_answer when 'expired' then 'link_expired' else v_answer end);
end
$$;

revoke all on function public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_variation_respond_by_token(text, uuid, text, uuid, text, text, text, text) to metra_app;
  end if;
end
$$;

-- "I paid" on one payment request of the home's contract:
-- app_delivery_claim_request_by_token (the amount is the server's, B4 AC33).
-- Its `expired` is the home link's (it reads the same delivery token).
create or replace function public.app_home_claim_request_by_token(
  p_hash text,
  p_request_id uuid,
  p_challenge_id uuid,
  p_code_hash text,
  p_note text,
  p_name text,
  p_ip text,
  p_ua text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_home       record;
  v_check      text;
  v_answer     text;
  v_result_ref uuid;
begin
  select d.* into v_home from public.app_home_delivery(p_hash) d;
  if not found then return jsonb_build_object('code', 'invalid'); end if;
  if not v_home.live then return jsonb_build_object('code', 'token_expired'); end if;
  if v_home.state <> 'execution' then return jsonb_build_object('code', 'not_active'); end if;

  if not exists (
    select 1 from public.payment_requests r
     where r.org_id = v_home.org_id
       and r.id = p_request_id
       and r.contract_id = public.app_delivery_execution_contract(v_home.id, v_home.org_id)
  ) then
    return jsonb_build_object('code', 'wrong_target');
  end if;

  v_check := public.app_client_code_check(
    v_home.id, v_home.org_id, p_challenge_id, 'claim_request', p_request_id::text, p_code_hash
  );
  if v_check <> 'ok' then return public.app_client_code_refusal(v_check); end if;

  perform set_config('app.client_code_verified', 'on', true);
  v_answer := public.app_delivery_claim_request_by_token(p_hash, p_request_id, p_note, p_name, p_ip, p_ua);
  perform set_config('app.client_code_verified', 'off', true);

  if v_answer = 'ok' then
    select pc.id into v_result_ref
      from public.contract_payment_claims pc
     where pc.org_id = v_home.org_id and pc.request_id = p_request_id and pc.status = 'pending';
    perform public.app_client_code_consume(p_challenge_id, v_result_ref);
  end if;
  return jsonb_build_object('code', case v_answer when 'expired' then 'token_expired' else v_answer end);
end
$$;

revoke all on function public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_claim_request_by_token(text, uuid, uuid, text, text, text, text, text) to metra_app;
  end if;
end
$$;

-- "I paid" on one design-fee instalment of the delivery:
-- app_delivery_claim_payment_by_token. The milestone kind is the code's
-- target, so a kind no code was sent for is `code_unknown`; the inner function
-- answers the stage (`not_active` at execution and after), and its `expired`
-- is the home link's.
create or replace function public.app_home_claim_design_payment_by_token(
  p_hash text,
  p_milestone_kind text,
  p_challenge_id uuid,
  p_code_hash text,
  p_note text,
  p_name text,
  p_ip text,
  p_ua text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_home       record;
  v_check      text;
  v_answer     text;
  v_result_ref uuid;
begin
  select d.* into v_home from public.app_home_delivery(p_hash) d;
  if not found then return jsonb_build_object('code', 'invalid'); end if;
  if not v_home.live then return jsonb_build_object('code', 'token_expired'); end if;

  v_check := public.app_client_code_check(
    v_home.id, v_home.org_id, p_challenge_id, 'claim_design_payment', p_milestone_kind, p_code_hash
  );
  if v_check <> 'ok' then return public.app_client_code_refusal(v_check); end if;

  perform set_config('app.client_code_verified', 'on', true);
  v_answer := public.app_delivery_claim_payment_by_token(p_hash, p_milestone_kind, p_note, p_name, p_ip, p_ua);
  perform set_config('app.client_code_verified', 'off', true);

  if v_answer = 'ok' then
    select pc.id into v_result_ref
      from public.client_payment_claims pc
     where pc.org_id = v_home.org_id and pc.engagement_id = v_home.id
       and pc.milestone_kind::text = p_milestone_kind and pc.status = 'pending';
    perform public.app_client_code_consume(p_challenge_id, v_result_ref);
  end if;
  return jsonb_build_object('code', case v_answer when 'expired' then 'token_expired' else v_answer end);
end
$$;

revoke all on function public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_home_claim_design_payment_by_token(text, text, uuid, text, text, text, text, text) to metra_app;
  end if;
end
$$;

-- Public share: where an old contract (/c) or change-order (/v) link should
-- send its holder now: the client home that document belongs to. p_kind is
-- 'contract' or 'variation', p_hash that link's token hash. Answers
-- {engagement_id, token_hash, token_nonce, focus_id} (the HOME's hash and
-- nonce, from which the server re-derives the home's raw link; focus_id the
-- contract's or change order's id), or NULL, uniformly, unless ALL of:
--   * the token is a BOQ contract's that the client can see (issued, signed
--     or terminated), or a change order's of such a contract that the client
--     can see (issued, approved or rejected);
--   * a delivery at `execution` owns that contract's BOQ (app_delivery_boqs);
--   * that delivery's link is live (set, and not expired).
-- So an unknown, revoked or never-issued token, a proposal contract and a
-- document with no live home all answer the same NULL, and the page renders
-- what it renders today: no oracle. Read only by the /c and /v pages' server.
create or replace function public.app_client_home_target_by_token(p_kind text, p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with document as materialized (
    select c.org_id, c.source_boq_id, c.id as focus_id
      from public.contracts c
     where p_kind = 'contract'
       and c.token_hash = p_hash
       and c.source_boq_id is not null
       and c.status in ('issued', 'signed', 'terminated')
    union all
    select c.org_id, c.source_boq_id, v.id
      from public.variation_orders v
      join public.contracts c on c.org_id = v.org_id and c.id = v.contract_id
     where p_kind = 'variation'
       and v.token_hash = p_hash
       and v.status in ('issued', 'approved', 'rejected')
       and c.source_boq_id is not null
       and c.status in ('issued', 'signed', 'terminated')
  )
  select jsonb_build_object(
    'engagement_id', de.id,
    'token_hash', de.token_hash,
    'token_nonce', de.token_nonce,
    'focus_id', d.focus_id
  )
  from document d
  join public.boqs b on b.org_id = d.org_id and b.id = d.source_boq_id
  join public.design_engagements de
    on de.org_id = b.org_id
   and (de.id = b.engagement_id or de.project_id = b.project_id)
  where de.state = 'execution'
    and de.token_hash is not null
    and (de.share_expires_at is null or de.share_expires_at > now())
    and exists (
      select 1 from public.app_delivery_boqs(de.id, de.org_id) owned where owned.id = b.id
    )
  order by de.created_at, de.id
  limit 1;
$$;

revoke all on function public.app_client_home_target_by_token(text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_client_home_target_by_token(text, text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_client_home_target_by_token(text, text) to metra_app;
  end if;
end
$$;
