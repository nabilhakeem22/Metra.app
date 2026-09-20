-- rls/functions/30-contracts-variations.sql — contracts and variation orders: child-draft guards + token surfaces.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- P1 Slice 4 — Contracts + Variation Orders
-- =============================================================================

-- Child-draft guard: contract_sections / contract_lines may only be
-- inserted/updated/deleted while their parent contract is still 'draft'. Both
-- carry contract_id (lines denormalize it), so the lookup is direct. SECURITY
-- DEFINER so the status read is not itself RLS-filtered. Raises MT100 on a frozen
-- change. A cascade delete of a DRAFT contract still passes (parent is draft at
-- BEFORE DELETE time).
--
-- BOTH PARENTS ARE CHECKED ON UPDATE (wave 7), for the reason
-- `enforce_boq_child_draft` spells out in full further down this file: reading
-- only NEW's status admitted
--
--     update public.contract_lines set contract_id = '<a DRAFT contract>'
--      where id = '<a line of an ISSUED contract>'
--
-- because the status read was of the DRAFT target. `contracts` itself is never
-- touched, so `trg_contracts_immutable` does not fire, and metra_app holds
-- `update` on both child tables - so a signed document loses a line while its
-- frozen `original_value` stays at the signed figure. No product path writes
-- either column today; this is the future action, script or backfill the trigger
-- exists for.
--
-- OLD/NEW are read DIRECTLY rather than through `to_jsonb`: both attached tables
-- carry contract_id, and materialising a whole row as jsonb to read one uuid is
-- per-row cost on the deep copy that generates a contract from a proposal.
create or replace function public.enforce_contract_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  -- The parent the row is LEAVING (UPDATE) or being removed from (DELETE).
  -- OLD is NULL on INSERT, hence the guard.
  if TG_OP <> 'INSERT' then
    select status into st from public.contracts where id = OLD.contract_id;
    if st is not null and st <> 'draft' then
      raise exception
        'contract children are frozen once the contract leaves draft (status=%)', st
        using errcode = 'MT100';
    end if;
    if TG_OP = 'DELETE' then return OLD; end if;
    -- An UPDATE that does not move the row has only one parent, already read.
    if NEW.contract_id is not distinct from OLD.contract_id then return NEW; end if;
  end if;

  -- The parent the row is ARRIVING at: an INSERT, or an UPDATE that re-parents.
  select status into st from public.contracts where id = NEW.contract_id;
  if st is not null and st <> 'draft' then
    raise exception
      'contract children are frozen once the contract leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
  return NEW;
end
$$;

-- Child-draft guard: variation_order_lines may only be inserted/updated/deleted
-- while their parent VO is still 'draft'. Once a VO is internally approved (or
-- beyond) its lines and netDelta are frozen. Raises MT100 on a frozen change.
--
-- BOTH PARENTS ARE CHECKED ON UPDATE (wave 7) - the same hole as its two
-- siblings, and the one with the sharpest edge: `net_delta` is frozen at
-- internal approval, so moving a line OUT of an issued VO left an instruction
-- the client is being asked to sign claiming money for work its own lines no
-- longer describe.
create or replace function public.enforce_variation_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  -- The parent the row is LEAVING (UPDATE) or being removed from (DELETE).
  if TG_OP <> 'INSERT' then
    select status into st from public.variation_orders where id = OLD.variation_order_id;
    if st is not null and st <> 'draft' then
      raise exception
        'variation order lines are frozen once the VO leaves draft (status=%)', st
        using errcode = 'MT100';
    end if;
    if TG_OP = 'DELETE' then return OLD; end if;
    -- An UPDATE that does not move the row has only one parent, already read.
    if NEW.variation_order_id is not distinct from OLD.variation_order_id then
      return NEW;
    end if;
  end if;

  -- The parent the row is ARRIVING at: an INSERT, or an UPDATE that re-parents.
  select status into st from public.variation_orders where id = NEW.variation_order_id;
  if st is not null and st <> 'draft' then
    raise exception
      'variation order lines are frozen once the VO leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
  return NEW;
end
$$;

-- Public share: fetch a contract by its token hash as a nested JSON document.
-- SECURITY DEFINER (the token IS the authorization; no session). Only issued /
-- signed contracts are visible. OMITS every cost/margin column (unit_cost,
-- line_cost, line_margin, total_cost, total_margin) — a client must never see the
-- firm's cost basis. The document total is the immutable original_value.
create or replace function public.app_contract_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'number', c.number,
    'status', c.status,
    'title_ar', c.title_ar,
    'title_en', c.title_en,
    'currency', c.currency,
    'signature_date', c.signature_date,
    'start_date', c.start_date,
    'end_date', c.end_date,
    'retention_pct', c.retention_pct,
    'retention_release_terms_ar', c.retention_release_terms_ar,
    'retention_release_terms_en', c.retention_release_terms_en,
    'advance_pct', c.advance_pct,
    'advance_recovery_method', c.advance_recovery_method,
    'payment_terms_days', c.payment_terms_days,
    'payment_schedule_mode', c.payment_schedule_mode,
    'penalty_ar', c.penalty_ar,
    'penalty_en', c.penalty_en,
    'defects_liability_days', c.defects_liability_days,
    'scope_inclusions_ar', c.scope_inclusions_ar,
    'scope_inclusions_en', c.scope_inclusions_en,
    'scope_exclusions_ar', c.scope_exclusions_ar,
    'scope_exclusions_en', c.scope_exclusions_en,
    'terms_ar', c.terms_ar,
    'terms_en', c.terms_en,
    'discount_pct', c.discount_pct,
    'tax_rate', c.tax_rate,
    'supervision_pct', c.supervision_pct,
    'subtotal', c.subtotal,
    'discount_amount', c.discount_amount,
    'taxable_base', c.taxable_base,
    'tax_amount', c.tax_amount,
    'supervision_amount', c.supervision_amount,
    'original_value', c.original_value,
    'total', c.original_value,
    'share_expires_at', c.share_expires_at,
    'org', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id
    ),
    'sections', coalesce((
      select jsonb_agg(sec order by sec_sort)
      from (
        select s.sort_order as sec_sort,
          jsonb_build_object(
            'id', s.id,
            'title_ar', s.title_ar,
            'title_en', s.title_en,
            'section_subtotal', s.section_subtotal,
            'sort_order', s.sort_order,
            'lines', coalesce((
              select jsonb_agg(ln order by ln_sort)
              from (
                select l.sort_order as ln_sort,
                  jsonb_build_object(
                    'id', l.id,
                    'description_ar', l.description_ar,
                    'description_en', l.description_en,
                    'qty', l.qty,
                    'unit', l.unit,
                    'unit_price', l.unit_price,
                    'discount_pct', l.discount_pct,
                    'line_total', l.line_total,
                    'sort_order', l.sort_order
                  ) as ln
                from public.contract_lines l
                where l.section_id = s.id
              ) lx
            ), '[]'::jsonb)
          ) as sec
        from public.contract_sections s
        where s.contract_id = c.id
      ) sx
    ), '[]'::jsonb)
  )
  from public.contracts c
  join public.organizations o on o.id = c.org_id
  where c.token_hash = p_hash
    and c.status in ('issued', 'signed');
$$;

-- Public share: record a client's ELECTRONIC ACKNOWLEDGEMENT of a contract (NOT
-- a binding signature — A5). Flips issued->signed atomically, stamps the
-- signature date, and appends an append-only event carrying the actor name, IP,
-- user agent and the sha256 hash of the acknowledged document. Returns a status
-- code the route maps to token_invalid / token_expired / already_responded / ok.
create or replace function public.app_contract_ack_by_token(
  p_hash text,
  p_name text,
  p_ip text,
  p_ua text,
  p_pdf_hash text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  st  text;
  exp timestamptz;
  cid uuid;
  oid uuid;
  n   int;
begin
  select status, share_expires_at, id, org_id
    into st, exp, cid, oid
    from public.contracts
    where token_hash = p_hash;
  if not found then return 'not_found'; end if;
  if st <> 'issued' then return 'already'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;

  -- PURE status flip: the issued row is immutable except a whitelisted status
  -- transition (A1). The acknowledgement timestamp lives on the append-only event
  -- (decided_at) — writing signature_date here would change a locked column and
  -- trip the MT100 immutability trigger.
  update public.contracts
    set status = 'signed', updated_at = now()
    where id = cid and status = 'issued';
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;

  insert into public.contract_events
    (id, org_id, contract_id, kind, actor_name, ip, user_agent, pdf_hash, from_status, to_status)
    values (gen_random_uuid(), oid, cid, 'acknowledged', p_name, p_ip, p_ua, p_pdf_hash, 'issued', 'signed');

  return 'ok';
end
$$;

-- Public share: fetch a variation order by its token hash as a JSON document.
-- SECURITY DEFINER (the token IS the authorization; no session). Only issued /
-- approved / rejected VOs are visible. OMITS every cost/margin column. Currency
-- is inherited from the parent contract. netDelta (may be negative) is shown.
-- contract_active tells the reader whether the parent contract still carries
-- commercial change: termination rejects open VOs, so without it the portal
-- would read status='rejected' and tell the client THEY rejected the order.
create or replace function public.app_variation_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'number', v.number,
    'status', v.status,
    'title_ar', v.title_ar,
    'title_en', v.title_en,
    'reason_ar', v.reason_ar,
    'reason_en', v.reason_en,
    'net_delta', v.net_delta,
    'currency', c.currency,
    'contract_number', c.number,
    'share_expires_at', v.share_expires_at,
    'contract_active', (c.status in ('issued', 'signed')),
    -- WHO rejected this variation order (0051), or null when the row predates
    -- the column. `contract_active` alone could not tell a client's own refusal
    -- from a termination cascade, so the portal denied decisions clients had
    -- actually made. Newest `rejected` event wins.
    --
    -- `e.org_id = v.org_id` is what makes the index usable, and it is not
    -- decoration: the covering index is
    -- variation_order_events_variationOrder_idx (org_id, variation_order_id),
    -- a btree whose LEADING column must be constrained for an index scan. This
    -- function is `security definer ... set search_path = ''`, so no RLS policy
    -- injects an org predicate the way `org_isolation` does for the equivalent
    -- read in lib/variations/queries/list.ts — without it, this per-open portal
    -- read plans a full scan of the event ledger. It narrows nothing: the FK on
    -- variation_order_events is the composite (org_id, variation_order_id), so
    -- an event already cannot belong to an org other than its VO's.
    --
    -- ADDITIVE: an app that does not know this key ignores it, and an app that
    -- does, reading an un-applied function, gets undefined -> null -> today's
    -- behaviour. The deploy is therefore safe in EITHER order, exactly as
    -- `contract_active` already documents.
    'rejection_channel', (
      select e.actor_channel from public.variation_order_events e
      where e.org_id = v.org_id and e.variation_order_id = v.id and e.kind = 'rejected'
      order by e.decided_at desc, e.id desc limit 1
    ),
    'org', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id
    ),
    'lines', coalesce((
      select jsonb_agg(ln order by ln_sort)
      from (
        select l.sort_order as ln_sort,
          jsonb_build_object(
            'id', l.id,
            'description_ar', l.description_ar,
            'description_en', l.description_en,
            'qty', l.qty,
            'unit', l.unit,
            'unit_price', l.unit_price,
            'discount_pct', l.discount_pct,
            'line_total', l.line_total,
            'sort_order', l.sort_order
          ) as ln
        from public.variation_order_lines l
        where l.variation_order_id = v.id
      ) lx
    ), '[]'::jsonb)
  )
  from public.variation_orders v
  join public.contracts c on c.id = v.contract_id and c.org_id = v.org_id
  join public.organizations o on o.id = v.org_id
  where v.token_hash = p_hash
    and v.status in ('issued', 'approved', 'rejected');
$$;

-- Public share: record a client's approve/reject decision on a variation order.
-- Flips issued->approved|rejected atomically + appends an append-only event with
-- the actor name/IP/user agent. Returns a code the route maps to
-- token_invalid / token_expired / already_responded / ok.
create or replace function public.app_variation_respond_by_token(
  p_hash text,
  p_decision text,
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
  target text;
  st     text;
  exp    timestamptz;
  vid    uuid;
  oid    uuid;
  cst    text;
  n      int;
begin
  target := case
    when p_decision = 'approve' then 'approved'
    when p_decision = 'reject'  then 'rejected'
    else null
  end;
  if target is null then return 'invalid'; end if;

  select v.status, v.share_expires_at, v.id, v.org_id, c.status::text
    into st, exp, vid, oid, cst
    from public.variation_orders v
    join public.contracts c on c.id = v.contract_id and c.org_id = v.org_id
    where v.token_hash = p_hash;
  if not found then return 'not_found'; end if;
  -- A terminated contract carries no commercial change. Checked BEFORE the VO
  -- status: termination rejects open VOs, so the VO status alone would report
  -- 'already' and hide the real reason from the client.
  if cst not in ('issued', 'signed') then return 'contract_inactive'; end if;
  if st <> 'issued' then return 'already'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;

  update public.variation_orders
    set status = target::public.variation_status, updated_at = now()
    where id = vid and status = 'issued';
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;

  -- actor_channel = 'client' (0051): THIS is the client's own decision, and it
  -- is what lets the portal and the studio's register tell a refusal the client
  -- made from one the termination cascade made for them. The three staff writers
  -- stamp 'staff'.
  insert into public.variation_order_events
    (id, org_id, variation_order_id, kind, actor_channel, actor_name, ip, user_agent, from_status, to_status)
    values (gen_random_uuid(), oid, vid, target, 'client', p_name, p_ip, p_ua, 'issued', target);

  return 'ok';
end
$$;

-- Child-draft guard: boq_sections / boq_lines may only be inserted/updated/
-- deleted while their parent BOQ is still 'draft'. Both carry boq_id directly,
-- so the lookup is direct - exactly as it is for contracts. SECURITY DEFINER so
-- the status read is not itself RLS-filtered. Raises MT100 on a frozen change. A
-- cascade delete of a DRAFT boq still passes (parent is draft at BEFORE DELETE
-- time, and on a cascade the parent row is already gone within the same
-- transaction, so `st is null`).
--
-- BOTH PARENTS ARE CHECKED ON UPDATE, which is where the clone of
-- enforce_contract_child_draft was wrong. Reading only NEW's status admitted
--
--     update public.boq_lines set boq_id = '<a DRAFT boq>'
--      where id = '<a line of an ISSUED boq>'
--
-- because the status read was of the DRAFT target; `boqs` itself is never
-- touched, so trg_boqs_immutable does not fire either, and metra_app holds
-- `update` on boq_lines. The issued document silently loses a line while its
-- cached subtotal / total / total_cost stay at the issued figures. No product
-- path writes boqLines.boqId today - this is exactly the "future action, script,
-- or migration backfill" the trigger exists for.
--
-- THE THREE SIBLING GUARDS HAD THE SAME HOLE and wave 7 closed it in the same
-- shape: enforce_proposal_child_draft (proposal_sections, proposal_lines),
-- enforce_contract_child_draft (contract_sections, contract_lines) and
-- enforce_variation_child_draft (variation_order_lines). All five triggers now
-- read OLD as well as NEW on UPDATE, each with its own re-parent dbtest.
--
-- OLD/NEW are read DIRECTLY rather than through `to_jsonb`: both attached tables
-- carry boq_id, plpgsql resolves the field at runtime, and materialising an
-- 18-column row as jsonb to read one uuid is the per-row half of the cost on a
-- 2,000-line import (~4,300 invocations per full-replace save).
create or replace function public.enforce_boq_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  st text;
begin
  -- The parent the row is LEAVING (UPDATE) or being removed from (DELETE).
  -- OLD is NULL on INSERT, hence the guard.
  if TG_OP <> 'INSERT' then
    select status into st from public.boqs where id = OLD.boq_id;
    if st is not null and st <> 'draft' then
      raise exception
        'boq children are frozen once the boq leaves draft (status=%)', st
        using errcode = 'MT100';
    end if;
    if TG_OP = 'DELETE' then return OLD; end if;
    -- An UPDATE that does not move the row has only one parent, already read.
    if NEW.boq_id is not distinct from OLD.boq_id then return NEW; end if;
  end if;

  -- The parent the row is ARRIVING at: an INSERT, or an UPDATE that re-parents.
  select status into st from public.boqs where id = NEW.boq_id;
  if st is not null and st <> 'draft' then
    raise exception
      'boq children are frozen once the boq leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
  return NEW;
end
$$;
