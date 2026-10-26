-- rls/functions/65-execution-facts.sql: client home DB step C, the ONE source
-- of a delivery's execution facts (lead ruling after the H1 fix round: the
-- studio's cockpit and the client's home are two projections of ONE fact
-- model, so both read it through the SAME SQL, never a hand-copied twin).
--
-- Who reads what here:
--   * the studio, as metra_app under its own RLS, inside its org transaction
--     (lib/execution/queries: getExecutionFacts, the money facts, the measured
--     works and the measured lines of the final account);
--   * the client home's definer functions (functions/75-client-home.sql), as
--     their owner, after the share token has resolved the delivery;
--   * the delivery's execution card (functions/70-execution-portal.sql), for
--     which BOQs, and so which contracts, a delivery owns.
-- Every function is SECURITY INVOKER: it reads AS ITS CALLER, so metra_app sees
-- only its own studio's rows and a bare id of another studio answers nothing
-- (null, or no row). That is why metra_app may call them while the token
-- helpers that answer for any studio (app_delivery_execution_contract, the
-- client home's internal helpers) are revoked from it.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares; a `language sql` body is validated at CREATE time, so a callee
-- comes before its caller. Idempotent (`create or replace`), and every
-- function is locked down right after its CREATE (new-function-lockdown.test.ts).
-- Every read names `org_id`, resolved from the row the caller named: the
-- indexes lead with it, and the definer caller gets no RLS predicate to
-- supply it. rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- The BOQs a delivery owns: the ones generated for it (`engagement_id`), and,
-- for a LIGHT delivery (entry_phase 'execution', 0065), every BOQ of its
-- project that no delivery stands behind. A light delivery is found by its
-- project because an issued BOQ is frozen and cannot be re-pointed at it. The
-- one rule every "which contract does this delivery show" read takes.
create or replace function public.app_delivery_boqs(p_engagement_id uuid, p_org_id uuid)
returns table (id uuid, status text, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id, b.status::text, b.created_at
    from public.design_engagements de
    join public.boqs b on b.org_id = de.org_id
   where de.org_id = p_org_id
     and de.id = p_engagement_id
     and (
       b.engagement_id = de.id
       or (de.entry_phase = 'execution' and b.engagement_id is null and b.project_id = de.project_id)
     );
$$;

revoke all on function public.app_delivery_boqs(uuid, uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_delivery_boqs(uuid, uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_boqs(uuid, uuid) to metra_app;
  end if;
end
$$;

-- Every MEASURED line of one execution contract, with its FINAL measured
-- quantity and what approved change orders ordered on it: the input of the
-- final account (lib/execution/money/final-account.ts). Moved here, unchanged
-- in what it answers, from lib/execution/queries/measured-lines.ts.
--
-- The final measured quantity is the line's latest RECORDED reading (`seq
-- desc`, A12), found by ONE probe of the (org_id, contract_line_id, seq desc)
-- index per line (a LATERAL, A5 reliability R3): its cost follows the lines,
-- never the readings behind them.
create or replace function public.app_contract_measured_lines(p_contract_id uuid)
returns table (
  line_id uuid,
  section_id uuid,
  line_sort integer,
  item_code text,
  description_ar text,
  description_en text,
  unit text,
  qty numeric,
  unit_price numeric,
  discount_pct numeric,
  provisional boolean,
  measured_qty numeric,
  variation_qty numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with contract as materialized (
    select c.id, c.org_id from public.contracts c where c.id = p_contract_id
  ),
  ordered as materialized (
    select vl.contract_line_id, sum(vl.qty) as qty
      from contract k
      join public.variation_orders v
        on v.org_id = k.org_id and v.contract_id = k.id and v.status = 'approved'
      join public.variation_order_lines vl
        on vl.org_id = v.org_id and vl.variation_order_id = v.id
     where vl.contract_line_id is not null
     group by vl.contract_line_id
  )
  select l.id, l.section_id, l.sort_order, l.item_code, l.description_ar, l.description_en,
         l.unit::text, l.qty, l.unit_price, l.discount_pct, l.provisional,
         latest.measured_qty, coalesce(o.qty, 0)
    from contract k
    join public.contract_lines l on l.org_id = k.org_id and l.contract_id = k.id
    join lateral (
      select m.measured_qty from public.contract_line_measurements m
       where m.org_id = l.org_id and m.contract_line_id = l.id
       order by m.seq desc
       limit 1
    ) latest on true
    left join ordered o on o.contract_line_id = l.id;
$$;

revoke all on function public.app_contract_measured_lines(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_measured_lines(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_measured_lines(uuid) to metra_app;
  end if;
end
$$;

-- What the measured PROVISIONAL lines (decision D2a) add to the final account,
-- before the document discount: per line, round(residual x unit price, 4),
-- less round(that x line discount x 0.01, 4), where residual = measured -
-- contract qty - ordered. Numeric multiplication is exact and round() on
-- numeric is half away from zero, the money engine's rule (computeFinalAccount,
-- line for line). A scale-4 string; '0' when nothing is measured.
create or replace function public.app_contract_measured_works(p_contract_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(billed.gross - round(billed.gross * billed.discount_pct * 0.01, 4)), 0)::text
    from (
      select measured.discount_pct,
             round((measured.measured_qty - measured.qty - measured.variation_qty) * measured.unit_price, 4) as gross
        from public.app_contract_measured_lines(p_contract_id) measured
       where measured.provisional
    ) billed;
$$;

revoke all on function public.app_contract_measured_works(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_measured_works(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_measured_works(uuid) to metra_app;
  end if;
end
$$;

-- What has been billed, paid and claimed on one execution contract, aggregated
-- in ONE statement whatever the number of requests, payments or change orders
-- (plan A25). Moved here, unchanged in what it answers, from
-- lib/execution/queries/money-facts.ts, whose type documents each key. A
-- contract the caller cannot see bills nothing (every count 0, every list
-- empty). Counts are numbers, money scale-4 strings:
--   pending_claims, unpaid_requests, unclaimed_due_requests, open_variations,
--   issued_variations (issued, link live), expired_variations (issued, link
--   expired), unbilled_variations, issued_total, approved_deltas,
--   billed_milestones, final_account {outstanding, final_value} | null.
create or replace function public.app_contract_money_facts(p_contract_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with contract as materialized (
    select c.id, c.org_id from public.contracts c where c.id = p_contract_id
  ),
  req as materialized (
    select r.id, r.kind, r.milestone_id, r.variation_order_id, r.amount, r.status, r.created_at, r.voided_at,
           coalesce((select sum(p.amount) from public.contract_payments p
                      where p.org_id = r.org_id and p.request_id = r.id), 0) as paid
      from contract k
      join public.payment_requests r on r.org_id = k.org_id and r.contract_id = k.id
  ),
  vo as materialized (
    select v.id, v.status, v.net_delta, v.share_expires_at
      from contract k
      join public.variation_orders v on v.org_id = k.org_id and v.contract_id = k.id
  ),
  pending as materialized (
    select pc.request_id
      from contract k
      join public.contract_payment_claims pc
        on pc.org_id = k.org_id and pc.contract_id = k.id and pc.status = 'pending'
  )
  select jsonb_build_object(
    'pending_claims', (select count(*) from pending),
    'unpaid_requests', (select count(*) from req where req.status = 'issued' and req.amount > req.paid),
    'unclaimed_due_requests', (
      select count(*) from req
       where req.status = 'issued' and req.amount > req.paid
         and not exists (select 1 from pending where pending.request_id = req.id)
    ),
    'open_variations', (select count(*) from vo where vo.status in ('internal_approved', 'issued')),
    'issued_variations', (
      select count(*) from vo
       where vo.status = 'issued' and (vo.share_expires_at is null or vo.share_expires_at > now())
    ),
    'expired_variations', (select count(*) from vo where vo.status = 'issued' and vo.share_expires_at <= now()),
    'unbilled_variations', (
      select count(*) from vo
       where vo.status = 'approved' and vo.net_delta > 0
         and not exists (select 1 from req where req.variation_order_id = vo.id and req.status = 'issued')
    ),
    'issued_total', coalesce((select sum(req.amount) from req where req.status = 'issued'), 0)::text,
    'approved_deltas', coalesce((select jsonb_agg(vo.net_delta::text) from vo where vo.status = 'approved'), '[]'::jsonb),
    'billed_milestones', coalesce(
      (select jsonb_agg(req.milestone_id) from req where req.status = 'issued' and req.milestone_id is not null),
      '[]'::jsonb
    ),
    'final_account', (
      select jsonb_build_object(
        'outstanding', (f.amount - f.paid)::text,
        'final_value', (f.amount + coalesce((
          select sum(o.amount) from req o
           where o.kind <> 'final_account' and o.created_at <= f.created_at
             and (o.status = 'issued' or o.voided_at > f.created_at)
        ), 0))::text
      )
      from req f
      where f.kind = 'final_account' and f.status = 'issued'
      limit 1
    )
  );
$$;

revoke all on function public.app_contract_money_facts(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_money_facts(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_money_facts(uuid) to metra_app;
  end if;
end
$$;

-- Everything a delivery's execution facts are derived from, in ONE statement:
-- the input of lib/execution/flow-source.ts, the one TypeScript derivation both
-- the cockpit and the client home run. Null when the caller cannot see the
-- delivery. Answers:
--   issued_boq_id  the newest issued BOQ the delivery owns (app_delivery_boqs),
--                  what "create contract" generates from; null when none;
--   contract       null, or the newest contract on a BOQ the delivery owns, a
--                  live one before a terminated one, ANY status (the studio
--                  works on a draft; the client home masks it). A terminated
--                  contract on an older BOQ does not stand in front of a newer
--                  issued BOQ: then null, so the studio is offered a new one.
--                  {id, number, created_at, status, signing_open (issued, and
--                  its online signing window still open, OD7), the money basis
--                  original_value, tax_amount, tax_rate, supervision_pct (the
--                  CLIENT CHARGE rate, shown on /c and /v; never a cost),
--                  discount_pct, schedule [{id, label_ar, label_en, basis,
--                  value, sort_order}] by sort order, money
--                  (app_contract_money_facts, signed only, else null),
--                  measured_works (app_contract_measured_works, signed with no
--                  final account issued only, else null)}.
create or replace function public.app_execution_flow_source(p_engagement_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with delivery as materialized (
    select de.id, de.org_id from public.design_engagements de where de.id = p_engagement_id
  ),
  owned as materialized (
    select b.id, b.status, b.created_at
      from delivery d
     cross join lateral public.app_delivery_boqs(d.id, d.org_id) b
  ),
  issued_boq as materialized (
    select o.id from owned o where o.status = 'issued' order by o.created_at desc, o.id desc limit 1
  ),
  newest as materialized (
    select c.id, c.org_id, c.number, c.created_at, c.status, c.source_boq_id, c.share_expires_at,
           c.original_value, c.tax_amount, c.tax_rate, c.supervision_pct, c.discount_pct
      from delivery d
      join owned o on true
      join public.contracts c on c.org_id = d.org_id and c.source_boq_id = o.id
     order by (c.status = 'terminated'), c.created_at desc, c.id desc
     limit 1
  ),
  contract as materialized (
    select n.* from newest n
     where not (n.status = 'terminated' and exists (select 1 from issued_boq i where i.id <> n.source_boq_id))
  ),
  billing as materialized (
    select k.id, case when k.status = 'signed' then public.app_contract_money_facts(k.id) end as money
      from contract k
  )
  select jsonb_build_object(
    'issued_boq_id', (select i.id from issued_boq i),
    'contract', (
      select jsonb_build_object(
        'id', k.id,
        'number', k.number,
        'created_at', k.created_at,
        'status', k.status,
        'signing_open', k.status = 'issued' and (k.share_expires_at is null or k.share_expires_at > now()),
        'original_value', k.original_value::text,
        'tax_amount', k.tax_amount::text,
        'tax_rate', k.tax_rate::text,
        'supervision_pct', k.supervision_pct::text,
        'discount_pct', k.discount_pct::text,
        'schedule', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'label_ar', m.label_ar,
              'label_en', m.label_en,
              'basis', m.basis,
              'value', m.value::text,
              'sort_order', m.sort_order
            ) order by m.sort_order
          )
          from public.contract_payment_milestones m
          where m.org_id = k.org_id and m.contract_id = k.id
        ), '[]'::jsonb),
        'money', b.money,
        'measured_works', case
          when jsonb_typeof(b.money -> 'final_account') = 'null' then public.app_contract_measured_works(k.id)
        end
      )
      from contract k
      join billing b on b.id = k.id
    )
  )
  from delivery;
$$;

revoke all on function public.app_execution_flow_source(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_execution_flow_source(uuid) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_execution_flow_source(uuid) to metra_app;
  end if;
end
$$;
