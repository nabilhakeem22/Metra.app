-- rls/functions/70-execution-portal.sql: Stage 2 DB step B, the client's
-- execution card on the delivery page (/d, owner decision D1a): what the
-- client is asked to pay on the execution contract, what was received, how to
-- pay, and the client's "I paid" on one payment request.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee is created before its caller: the two internal helpers come first.
-- Idempotent (`create or replace`), and every function is locked down right
-- after its CREATE (new-function-lockdown.test.ts). rls/**.sql is exempt from
-- the 150-line rule (stack-profile.md).
--
-- NOT app_delivery_by_token: that snapshot is untouched (plan, out of scope),
-- so its cost on a long delivery does not move; the page reads this second
-- snapshot only for a delivery at `execution`.
--
-- CLIENT-SAFE BY CONSTRUCTION, as app_delivery_by_token: every function here
-- names the columns it reads, and none of them is a price-basis column of the
-- studio. The prosrc tests (delivery-execution.dbtest.ts) hold the bodies to the
-- same strict word list as the delivery snapshot's, comments included, so the
-- bodies below carry no comment that could trip it.

-- INTERNAL: which execution contract the client of a delivery sees (plan A26).
-- The newest contract generated from a BOQ of this delivery that the client
-- can see (issued, signed or terminated; a draft is the studio's working
-- copy), a live one before a terminated one. The read and the claim below both
-- ask it, so the request a client claims is always one of the contract the
-- card shows. It takes bare ids, so it is revoked from every caller role,
-- metra_app included: only the definer functions in this file call it, as
-- their owner (the app_client_act_anchor pattern). SECURITY INVOKER.
create or replace function public.app_delivery_execution_contract(
  p_engagement_id uuid,
  p_org_id uuid
)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id
    from public.boqs b
    join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id
   where b.org_id = p_org_id
     and b.engagement_id = p_engagement_id
     and c.status in ('issued', 'signed', 'terminated')
   order by (c.status = 'terminated'), c.created_at desc, c.id desc
   limit 1;
$$;

revoke all on function public.app_delivery_execution_contract(uuid, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_execution_contract(uuid, uuid) from %I',
        r
      );
    end if;
  end loop;
end
$$;

-- INTERNAL: the studio's own payment instructions, by the rule the delivery
-- snapshot applies today (0058): null unless an InstaPay address, an account
-- number or an IBAN is set (an account number and an IBAN each need a bank
-- name, by CHECK). WHEN they are shown is the caller's rule. Revoked from every
-- caller role, metra_app included, like the helper above: it takes a bare org
-- id. SECURITY INVOKER.
create or replace function public.app_studio_payment_details(p_org_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when o.instapay_address is null and o.bank_account_number is null and o.bank_iban is null then null
    else jsonb_build_object(
      'instapay', o.instapay_address,
      'bank_name', o.bank_name,
      'bank_account_holder', o.bank_account_holder,
      'bank_account_number', o.bank_account_number,
      'bank_iban', o.bank_iban
    )
  end
  from public.organizations o
  where o.id = p_org_id;
$$;

revoke all on function public.app_studio_payment_details(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_studio_payment_details(uuid) from %I', r);
    end if;
  end loop;
end
$$;

-- Public share: the delivery's execution card, by the delivery's token hash.
-- SECURITY DEFINER (the token IS the authorization; no session).
--
-- NULL, uniformly, unless ALL of: the link is live (the share_expires_at rule
-- of app_delivery_by_token), the delivery is at `execution`, and it has a
-- contract the client can see (app_delivery_execution_contract). So an
-- unknown, revoked or expired link, a delivery at any other stage, and one
-- with no execution contract all look the same (AC32).
--
-- Otherwise:
--   contract   {number, year (its creation year in Cairo, the year C-YYYY-NNNN
--              shows), status, title_ar, title_en, original_value}
--   requests   the newest 60 payment requests by number, each {id, number,
--              year (its issue day's year, the year PR-YYYY-NNNN shows), kind,
--              label_ar, label_en (the schedule row's, for a milestone),
--              variation_number, variation_year (the change order's, for a
--              change order: its creation year in Cairo), amount, issued_on,
--              due_on, paid, outstanding (0 on a void request), status,
--              has_pending_claim, claimed_at (that claim's created_at)}
--   requests_truncated  the contract has more than 60 requests
--   receipts   the newest 60 payments, {amount, received_on, request_number,
--              request_year}: never a method, a reference, a note or who
--              recorded it. Newest by the day received, then by when the
--              studio recorded it (B4 F8: same-day payments newest first)
--   receipts_truncated  more than 60 payments
--   earlier_claims  the client's claims still waiting on the delivery's OTHER
--              contracts (B4 F6: a claim on a contract the card no longer
--              shows stays visible), at most 10, newest first, each
--              {request_number, request_year, amount (what was claimed),
--              claimed_at}
--   payment_details  app_studio_payment_details, ONLY while some issued
--              request of the contract (any of them, not only the 60 shown)
--              still has something due (AC35); else null
-- Money and days are strings (scale 4; YYYY-MM-DD). Every read names
-- `org_id`: the indexes lead with it, and a definer gets no RLS predicate.
-- What is paid is summed ONCE per contract, grouped by request (B4 R4), not
-- once per request, so a contract with many requests costs one scan of its
-- payments.
create or replace function public.app_delivery_execution_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with delivery as materialized (
    select de.id, de.org_id
      from public.design_engagements de
     where de.token_hash = p_hash
       and de.state = 'execution'
       and (de.share_expires_at is null or de.share_expires_at > now())
  ),
  contract as materialized (
    select c.id, c.org_id, c.number, c.status, c.title_ar, c.title_en, c.original_value, c.created_at,
           d.id as engagement_id
      from delivery d
      join public.contracts c
        on c.org_id = d.org_id
       and c.id = public.app_delivery_execution_contract(d.id, d.org_id)
  ),
  paid_by_request as materialized (
    select p.request_id, sum(p.amount) as paid
      from contract k
      join public.contract_payments p on p.org_id = k.org_id and p.contract_id = k.id
     group by p.request_id
  ),
  billed as materialized (
    select r.id, r.number, r.kind, r.status, r.amount, r.issued_on, r.due_on,
           r.milestone_id, r.variation_order_id,
           coalesce(pp.paid, 0) as paid
      from contract k
      join public.payment_requests r on r.org_id = k.org_id and r.contract_id = k.id
      left join paid_by_request pp on pp.request_id = r.id
  ),
  shown as materialized (
    select b.* from billed b order by b.number desc limit 61
  ),
  received as materialized (
    select p.id, p.amount, p.received_on, p.created_at, r.number as request_number,
           extract(year from r.issued_on)::int as request_year
      from contract k
      join public.contract_payments p on p.org_id = k.org_id and p.contract_id = k.id
      join public.payment_requests r on r.org_id = p.org_id and r.id = p.request_id
     order by p.received_on desc, p.created_at desc, p.id desc
     limit 61
  ),
  earlier as materialized (
    select pc.id, pc.claimed_amount, pc.created_at, r.number as request_number,
           extract(year from r.issued_on)::int as request_year
      from contract k
      join public.boqs b on b.org_id = k.org_id and b.engagement_id = k.engagement_id
      join public.contracts c on c.org_id = b.org_id and c.source_boq_id = b.id and c.id <> k.id
      join public.contract_payment_claims pc
        on pc.org_id = c.org_id and pc.contract_id = c.id and pc.status = 'pending'
      join public.payment_requests r on r.org_id = pc.org_id and r.id = pc.request_id
     order by pc.created_at desc, pc.id desc
     limit 10
  )
  select jsonb_build_object(
    'contract', jsonb_build_object(
      'number', k.number,
      'year', extract(year from k.created_at at time zone 'Africa/Cairo')::int,
      'status', k.status,
      'title_ar', k.title_ar,
      'title_en', k.title_en,
      'original_value', k.original_value::text
    ),
    'requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'number', s.number,
          'year', extract(year from s.issued_on)::int,
          'kind', s.kind,
          'label_ar', m.label_ar,
          'label_en', m.label_en,
          'variation_number', v.number,
          'variation_year', extract(year from v.created_at at time zone 'Africa/Cairo')::int,
          'amount', s.amount::text,
          'issued_on', to_char(s.issued_on, 'YYYY-MM-DD'),
          'due_on', to_char(s.due_on, 'YYYY-MM-DD'),
          'paid', s.paid::numeric(18, 4)::text,
          'outstanding', (case when s.status = 'issued' then greatest(s.amount - s.paid, 0) else 0 end)::numeric(18, 4)::text,
          'status', s.status,
          'has_pending_claim', pc.created_at is not null,
          'claimed_at', pc.created_at
        ) order by s.number desc
      )
      from (select * from shown order by number desc limit 60) s
      left join public.contract_payment_milestones m on m.org_id = k.org_id and m.id = s.milestone_id
      left join public.variation_orders v on v.org_id = k.org_id and v.id = s.variation_order_id
      left join public.contract_payment_claims pc
        on pc.org_id = k.org_id and pc.request_id = s.id and pc.status = 'pending'
    ), '[]'::jsonb),
    'requests_truncated', (select count(*) from shown) > 60,
    'receipts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'amount', x.amount::text,
          'received_on', to_char(x.received_on, 'YYYY-MM-DD'),
          'request_number', x.request_number,
          'request_year', x.request_year
        ) order by x.received_on desc, x.created_at desc, x.id desc
      )
      from (select * from received order by received_on desc, created_at desc, id desc limit 60) x
    ), '[]'::jsonb),
    'receipts_truncated', (select count(*) from received) > 60,
    'earlier_claims', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'request_number', e.request_number,
          'request_year', e.request_year,
          'amount', e.claimed_amount::text,
          'claimed_at', e.created_at
        ) order by e.created_at desc, e.id desc
      )
      from earlier e
    ), '[]'::jsonb),
    'payment_details', case
      when exists (select 1 from billed b where b.status = 'issued' and b.amount > b.paid)
        then public.app_studio_payment_details(k.org_id)
    end
  )
  from contract k;
$$;

-- Same-transaction lockdown: a NEW signature is executable by PUBLIC (and, on
-- Supabase, by the API roles) from the moment CREATE commits.
revoke all on function public.app_delivery_execution_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_delivery_execution_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_execution_by_token(text) to metra_app;
  end if;
end
$$;

-- Public share: the client's "I paid" on ONE payment request of the delivery's
-- execution contract, by the delivery's token hash. SECURITY DEFINER (the
-- token IS the authorization). It APPENDS one `pending` contract_payment_claims
-- row and never writes the payment ledger: the studio confirms or dismisses
-- the claim (lib/execution/claims), and only a confirm records money.
--
-- THE AMOUNT IS THE SERVER'S (AC33): claimed_amount = what is still due on the
-- request, read under the request's row lock. The client sends no amount.
--
-- Codes, uniform: ok | already | expired | not_active | wrong_state | invalid | busy
--   invalid      no delivery has this token hash (unknown or revoked link)
--   expired      the link's share_expires_at has passed
--   not_active   the delivery is not at `execution`, or has no contract the
--                client can see
--   wrong_state  the request is not one of THAT contract's (a forged or
--                foreign id, null included), or it is void, or nothing is due
--                on it (AC34): one code, so no oracle about other requests
--   already      a claim on this request is pending (a repeat tap)
--   busy         10 claims on this contract in the last hour (any status):
--                the flood ceiling (AC34)
--   ok           the claim landed, and the studio was told
--
-- THE STUDIO HEARS IT IN THE SAME TRANSACTION: one in-app notification per
-- owner / admin / accountant member (kind `client_responded`, body
-- `client_request_claimed`, entity `contract` + its id, params {number, year}:
-- the REQUEST's number and its issue year, the PR-YYYY-NNNN the studio sees).
-- No other role, never the `client` role, and no email.
--
-- LOCKS, in this order: an advisory lock per CONTRACT (so two claims on two
-- requests of one contract cannot both pass the ceiling), then the request row
-- FOR UPDATE (the plan's money lock: a concurrent payment, void or confirm of
-- that request finishes first, and the due figure is read after it). The
-- studio's confirm core locks the claim, then the request; this function never
-- locks a claim, so the two cannot deadlock. The arbiter of the insert is the
-- pending-claim unique index, (org_id, request_id) WHERE status = 'pending'
-- (A2 security S2), so a concurrent first claim answers `already`.
--
-- LOCK TIMEOUT: every wait above is at most 4 s, then the call fails with
-- 55P03 and rolls back whole, before the app's 15 s database deadline (the
-- delivery portal's rule, 50-delivery-write.sql). The setting holds only
-- inside this function.
--
-- THE CALLER'S name / ip / ua are capped 120 / 45 / 512 and the note 2,000,
-- as the other delivery writes: this function is the trust boundary for what
-- reaches the claim row. A successful claim refreshes the delivery's
-- updated_at, as every client act does (newest-first lists), BEST EFFORT (B4
-- R2): only when nobody holds the delivery row (`skip locked`). A studio save
-- of the delivery in flight skips the timestamp; it never fails the claim, nor
-- holds the request lock (and so the studio's money writers on it) while it
-- waits.
create or replace function public.app_delivery_claim_request_by_token(
  p_hash text,
  p_request_id uuid,
  p_note text,
  p_name text,
  p_ip text,
  p_ua text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '4s'
as $$
declare
  v_engagement_id uuid;
  v_org_id        uuid;
  v_state         text;
  v_expires_at    timestamptz;
  v_contract_id   uuid;
  v_status        text;
  v_amount        numeric;
  v_number        integer;
  v_year          integer;
  v_due           numeric;
  v_claim_id      uuid;
begin
  select de.id, de.org_id, de.state::text, de.share_expires_at
    into v_engagement_id, v_org_id, v_state, v_expires_at
    from public.design_engagements de
   where de.token_hash = p_hash;
  if not found then return 'invalid'; end if;
  if v_expires_at is not null and v_expires_at <= now() then return 'expired'; end if;
  if v_state <> 'execution' then return 'not_active'; end if;

  v_contract_id := public.app_delivery_execution_contract(v_engagement_id, v_org_id);
  if v_contract_id is null then return 'not_active'; end if;
  if p_request_id is null then return 'wrong_state'; end if;

  perform pg_advisory_xact_lock(hashtextextended('contract-payment-claims:' || v_contract_id::text, 0));

  select r.status::text, r.amount, r.number, extract(year from r.issued_on)::int
    into v_status, v_amount, v_number, v_year
    from public.payment_requests r
   where r.org_id = v_org_id
     and r.contract_id = v_contract_id
     and r.id = p_request_id
   for update;
  if not found or v_status <> 'issued' then return 'wrong_state'; end if;

  v_due := v_amount - coalesce((
    select sum(p.amount) from public.contract_payments p
     where p.org_id = v_org_id and p.request_id = p_request_id
  ), 0);
  if v_due <= 0 then return 'wrong_state'; end if;

  if exists (
    select 1 from public.contract_payment_claims pc
     where pc.org_id = v_org_id and pc.request_id = p_request_id and pc.status = 'pending'
  ) then
    return 'already';
  end if;

  if (
    select count(*) from public.contract_payment_claims pc
     where pc.org_id = v_org_id
       and pc.contract_id = v_contract_id
       and pc.created_at > now() - interval '1 hour'
  ) >= 10 then
    return 'busy';
  end if;

  insert into public.contract_payment_claims
    (org_id, contract_id, request_id, claimed_amount, note, actor_name, actor_ip, actor_user_agent)
  values (
    v_org_id, v_contract_id, p_request_id, v_due::numeric(18, 4),
    nullif(left(btrim(coalesce(p_note, '')), 2000), ''),
    nullif(left(btrim(coalesce(p_name, '')), 120), ''),
    nullif(left(coalesce(p_ip, ''), 45), ''),
    nullif(left(coalesce(p_ua, ''), 512), '')
  )
  on conflict (org_id, request_id) where status = 'pending' do nothing
  returning id into v_claim_id;
  if v_claim_id is null then return 'already'; end if;

  insert into public.notifications
    (org_id, recipient_user_id, kind, entity_type, entity_id, body_key, params)
  select v_org_id, m.user_id, 'client_responded', 'contract', v_contract_id, 'client_request_claimed',
         jsonb_build_object('number', v_number, 'year', v_year)
    from public.memberships m
   where m.org_id = v_org_id
     and m.role::text in ('owner', 'admin', 'accountant');

  update public.design_engagements de
     set updated_at = now()
   where de.id = (
     select x.id from public.design_engagements x
      where x.id = v_engagement_id
        for no key update skip locked
   );
  return 'ok';
end
$$;

-- Same-transaction lockdown, as for the read above.
revoke all on function public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_claim_request_by_token(text, uuid, text, text, text, text) to metra_app;
  end if;
end
$$;
