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
--
-- THE PARENT IS READ `FOR SHARE` (Stage 2, A2 reliability R1). A plain read
-- under READ COMMITTED saw the last COMMITTED status, so a child written while
-- an issue was in flight read `draft` and committed into an ISSUED contract
-- (measured: 10 of 10 milestones landed in a schedule no issue gate saw). FOR
-- SHARE conflicts with the issuer's row lock: the child waits for the issue to
-- commit, re-reads the row as `issued`, and raises MT100. All children share
-- the lock, so concurrent child writes do not block one another; only a status
-- change waits for them (and the issue core locks the contract FOR UPDATE
-- before it reads the schedule, plan A3.2 addendum). The writer that inserted
-- the contract in the same transaction already holds it, so the deep copy
-- pays nothing; on a cascade delete the parent is already gone (no row).
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
    select status into st from public.contracts where id = OLD.contract_id for share;
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
  select status into st from public.contracts where id = NEW.contract_id for share;
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
--
-- STAGE 2 (0063) added, and the app reads:
--   * `source`: 'proposal' or 'boq' (an execution contract);
--   * `payment_schedule`: the signed schedule rows {label_ar, label_en, basis,
--     value, sort_order}, by sort order ([] on a proposal contract), `value` as
--     a scale-4 STRING (a jsonb numeric reaches JavaScript as a float, and the
--     money law is strings). Amounts are derived by the app from
--     original_value (milestoneAmounts);
--   * per section `line_count` (every line of the section, counted);
--   * line `item_code` and `provisional` (a BOQ contract's; null / false on a
--     proposal contract's);
--   * `time_extension_days_total`: the days the APPROVED change orders add to
--     the finish date;
--   * `signed` (A3 fix round, F3/F4): null until the contract is signed, then
--     {on, via}: the signing DAY in Cairo as `YYYY-MM-DD` (never a UTC
--     timestamp, which shows the day before for a paper signature recorded at
--     Cairo midnight) and how: 'online' (the client's acknowledgement here) or
--     'paper' (recorded by the studio), read from the contract's own events.
--
-- THE CAP (DB step B, lead rulings Oct 19 and Oct 20 D5). What the /c page
-- opens with, so the document a client downloads does not grow with the
-- contract, by its lines OR its sections:
--   * `sections`: the FIRST 50 sections by (sort_order, id), each with its
--     line_count;
--   * their `lines`: between them, the FIRST 50 LINES OF THE WHOLE CONTRACT in
--     document order (section sort_order, section id, line sort_order, line
--     id), NOT 50 per section (that still grew with the sections). A section
--     past them carries `lines: []` and its line_count, and the page opens it
--     through app_contract_section_lines_by_token below;
--   * `section_count`: every section, counted; the page asks for the sections
--     past the first 50 through app_contract_sections_by_token below.
-- Only after A3.6 (the page loading lines lazily) is live: the step B runbook
-- (docs/DEPLOY.md) says so.
--
-- `lines_digest`: sha256 over EVERY line's client-visible fields, its section
-- included (a line moved between sections moves it), in order, plus the
-- schedule and, since step B, EVERY section's client-visible fields (id,
-- titles, subtotal, sort order). The acknowledgement hash covers the snapshot
-- and this digest, so a client acknowledges every line and every section, not
-- only the ones the capped snapshot carries.
--
-- Every sub-read names `org_id = c.org_id`: the indexes lead with org_id, and
-- this definer function gets no RLS predicate to supply it. The 3-column FK
-- contract_lines_section_same_contract_fk (0063) makes every line of a section
-- a line of that section's contract.
create or replace function public.app_contract_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as materialized (
    select c.id, c.org_id
      from public.contracts c
     where c.token_hash = p_hash
       and c.status in ('issued', 'signed')
  ),
  opening_sections as materialized (
    select s.id, s.org_id, s.contract_id, s.title_ar, s.title_en, s.section_subtotal, s.sort_order
      from target t
      join public.contract_sections s on s.org_id = t.org_id and s.contract_id = t.id
     order by s.sort_order, s.id
     limit 50
  ),
  opening_lines as materialized (
    select pick.id, pick.section_id, pick.sort_order
      from opening_sections s
     cross join lateral (
       select l.id, l.section_id, l.sort_order
         from public.contract_lines l
        where l.org_id = s.org_id and l.section_id = s.id
        order by l.sort_order, l.id
        limit 50
     ) pick
     order by s.sort_order, s.id, pick.sort_order, pick.id
     limit 50
  )
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
    'signed', (
      select jsonb_build_object(
        'on', to_char(e.decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
        'via', case e.kind when 'acknowledged_offline' then 'paper' else 'online' end
      )
      from public.contract_events e
      where e.org_id = c.org_id and e.contract_id = c.id
        and e.kind in ('acknowledged', 'acknowledged_offline')
      order by e.decided_at desc, e.id desc
      limit 1
    ),
    'source', case when c.source_boq_id is not null then 'boq' else 'proposal' end,
    'time_extension_days_total', coalesce((
      select sum(v.time_extension_days)
      from public.variation_orders v
      where v.org_id = c.org_id and v.contract_id = c.id and v.status = 'approved'
    ), 0),
    'payment_schedule', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'label_ar', m.label_ar,
          'label_en', m.label_en,
          'basis', m.basis,
          'value', m.value::text,
          'sort_order', m.sort_order
        ) order by m.sort_order
      )
      from public.contract_payment_milestones m
      where m.org_id = c.org_id and m.contract_id = c.id
    ), '[]'::jsonb),
    'lines_digest', encode(sha256(convert_to(jsonb_build_object(
      'lines', coalesce((
        select jsonb_agg(
          jsonb_build_array(
            l.id, l.section_id, l.item_code, l.description_ar, l.description_en, l.qty,
            l.unit, l.unit_price, l.discount_pct, l.line_total, l.provisional
          ) order by s.sort_order, s.id, l.sort_order, l.id
        )
        from public.contract_lines l
        join public.contract_sections s on s.id = l.section_id and s.org_id = l.org_id
        where l.org_id = c.org_id and l.contract_id = c.id
      ), '[]'::jsonb),
      'schedule', coalesce((
        select jsonb_agg(
          jsonb_build_array(m.label_ar, m.label_en, m.basis, m.value, m.sort_order)
          order by m.sort_order
        )
        from public.contract_payment_milestones m
        where m.org_id = c.org_id and m.contract_id = c.id
      ), '[]'::jsonb),
      'sections', coalesce((
        select jsonb_agg(
          jsonb_build_array(s.id, s.title_ar, s.title_en, s.section_subtotal, s.sort_order)
          order by s.sort_order, s.id
        )
        from public.contract_sections s
        where s.org_id = c.org_id and s.contract_id = c.id
      ), '[]'::jsonb)
    )::text, 'UTF8')), 'hex'),
    'org', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id
    ),
    'section_count', (
      select count(*) from public.contract_sections s
      where s.org_id = c.org_id and s.contract_id = c.id
    ),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title_ar', s.title_ar,
          'title_en', s.title_en,
          'section_subtotal', s.section_subtotal,
          'sort_order', s.sort_order,
          'line_count', (
            select count(*) from public.contract_lines l
            where l.org_id = s.org_id and l.contract_id = s.contract_id and l.section_id = s.id
          ),
          'lines', coalesce((
            select jsonb_agg((
              select jsonb_build_object(
                'id', l.id,
                'item_code', l.item_code,
                'description_ar', l.description_ar,
                'description_en', l.description_en,
                'qty', l.qty,
                'unit', l.unit,
                'unit_price', l.unit_price,
                'discount_pct', l.discount_pct,
                'line_total', l.line_total,
                'provisional', l.provisional,
                'sort_order', l.sort_order
              )
              from public.contract_lines l
              where l.org_id = s.org_id and l.id = ol.id
            ) order by ol.sort_order, ol.id)
            from opening_lines ol
            where ol.section_id = s.id
          ), '[]'::jsonb)
        ) order by s.sort_order, s.id
      )
      from opening_sections s
    ), '[]'::jsonb)
  )
  from target t
  join public.contracts c on c.id = t.id
  join public.organizations o on o.id = c.org_id;
$$;

-- Same-transaction lockdown (new-function-lockdown.test.ts): CREATE OR REPLACE
-- keeps an existing ACL, so for a replaced function this is convergence, not a
-- window; it is here so every token function this file creates or replaces is
-- locked down by the file that writes it.
revoke all on function public.app_contract_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_by_token(text) to metra_app;
  end if;
end
$$;

-- Stage 2 (0063): the lines of ONE section of the token's contract, 100 at a
-- time, for "show lines" on /c (A20). Shipped in DB step A so A3.6 can move the
-- page to it; since DB step B the snapshot carries only the first 50 lines of
-- the whole contract, and the page opens every other line here. Same
-- visibility as app_contract_by_token (issued or signed; the page shows an
-- expired contract read-only, so expiry does not hide lines).
-- Answers NULL, uniformly, for an unknown token, a contract not issued or
-- signed, or a section id that is not a section of THAT contract: no oracle
-- about other contracts' sections. `p_offset` is clamped to 0..100000 (null =
-- 0); lines are ordered (sort_order, id), the snapshot's order, so a section
-- the snapshot opened continues exactly where it stops. Cost-blind: the same
-- line keys as the snapshot, no unit_cost / line_cost / line_margin.
--
-- ONE SECTION'S ROWS, NEVER THE CONTRACT'S (A3 reliability R4). The token's
-- section is resolved FIRST (`target`, one row or none), and every line read
-- after it filters on that section alone, (org_id, section_id), so the scan is
-- the section's index and never the contract's: a page of a 100-line section
-- reads 100 lines whatever the contract holds. No `contract_id` predicate on
-- the lines: contract_lines_section_same_contract_fk (0063) already makes every
-- line of a section a line of that section's contract. The page picks its 100
-- ids (walking past `start_at` on the index) BEFORE building any JSON, so a
-- skipped line is never turned into a jsonb object; each picked line is then
-- read by its id, one primary-key probe each (a correlated sub-select, so the
-- planner cannot trade it for a join over every line of the studio).
create or replace function public.app_contract_section_lines_by_token(
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
  with target as materialized (
    select s.org_id, s.id as section_id,
           greatest(0, least(coalesce(p_offset, 0), 100000)) as start_at
    from public.contracts c
    join public.contract_sections s
      on s.org_id = c.org_id and s.contract_id = c.id and s.id = p_section_id
    where c.token_hash = p_hash
      and c.status in ('issued', 'signed')
  ),
  picked as materialized (
    select pick.id, pick.sort_order
    from target t
    cross join lateral (
      select l.id, l.sort_order
      from public.contract_lines l
      where l.org_id = t.org_id and l.section_id = t.section_id
      order by l.sort_order, l.id
      offset t.start_at
      limit 100
    ) pick
  )
  select jsonb_build_object(
    'section_id', t.section_id,
    'offset', t.start_at,
    'line_count', (
      select count(*) from public.contract_lines l
      where l.org_id = t.org_id and l.section_id = t.section_id
    ),
    'lines', coalesce((
      select jsonb_agg((
        select jsonb_build_object(
          'id', l.id,
          'item_code', l.item_code,
          'description_ar', l.description_ar,
          'description_en', l.description_en,
          'qty', l.qty,
          'unit', l.unit,
          'unit_price', l.unit_price,
          'discount_pct', l.discount_pct,
          'line_total', l.line_total,
          'provisional', l.provisional,
          'sort_order', l.sort_order
        )
        from public.contract_lines l
        where l.id = k.id
      ) order by k.sort_order, k.id)
      from picked k
    ), '[]'::jsonb)
  )
  from target t;
$$;

-- Same-transaction lockdown: a NEW signature is executable by PUBLIC (and, on
-- Supabase, by the API roles) from the moment CREATE commits.
revoke all on function public.app_contract_section_lines_by_token(text, uuid, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_contract_section_lines_by_token(text, uuid, integer) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_section_lines_by_token(text, uuid, integer) to metra_app;
  end if;
end
$$;

-- DB step B (A3 fix round, D5): the sections of the token's contract from
-- `p_offset`, 50 at a time, COLLAPSED (`lines: []`; the page opens a section's
-- lines through app_contract_section_lines_by_token above), for the /c page's
-- "show more sections". Before step B that answer was a slice of the whole
-- snapshot; now it reads 50 sections and counts their lines, whatever the
-- contract holds. Same visibility as app_contract_by_token (issued or signed).
-- NULL, uniformly, for an unknown token or a contract not issued or signed.
-- `p_offset` is clamped to 0..100000 (null = 0); sections are ordered
-- (sort_order, id), the snapshot's order, so offset 50 continues exactly where
-- the snapshot stops. Answers {offset, section_count, sections}, each section
-- as the snapshot shapes it. Cost-blind: a section has no cost column.
create or replace function public.app_contract_sections_by_token(p_hash text, p_offset integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as materialized (
    select c.id, c.org_id, greatest(0, least(coalesce(p_offset, 0), 100000)) as start_at
      from public.contracts c
     where c.token_hash = p_hash
       and c.status in ('issued', 'signed')
  ),
  picked as materialized (
    select s.id, s.org_id, s.contract_id, s.title_ar, s.title_en, s.section_subtotal, s.sort_order
      from target t
     cross join lateral (
       select x.id, x.org_id, x.contract_id, x.title_ar, x.title_en, x.section_subtotal, x.sort_order
         from public.contract_sections x
        where x.org_id = t.org_id and x.contract_id = t.id
        order by x.sort_order, x.id
        offset t.start_at
        limit 50
     ) s
  )
  select jsonb_build_object(
    'offset', t.start_at,
    'section_count', (
      select count(*) from public.contract_sections s
      where s.org_id = t.org_id and s.contract_id = t.id
    ),
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'title_ar', p.title_ar,
          'title_en', p.title_en,
          'section_subtotal', p.section_subtotal,
          'sort_order', p.sort_order,
          'line_count', (
            select count(*) from public.contract_lines l
            where l.org_id = p.org_id and l.contract_id = p.contract_id and l.section_id = p.id
          ),
          'lines', '[]'::jsonb
        ) order by p.sort_order, p.id
      )
      from picked p
    ), '[]'::jsonb)
  )
  from target t;
$$;

-- Same-transaction lockdown: a NEW signature is executable by PUBLIC (and, on
-- Supabase, by the API roles) from the moment CREATE commits.
revoke all on function public.app_contract_sections_by_token(text, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_contract_sections_by_token(text, integer) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_sections_by_token(text, integer) to metra_app;
  end if;
end
$$;

-- Public share: record a client's ELECTRONIC ACKNOWLEDGEMENT of a contract (NOT
-- a binding signature — A5). Flips issued->signed atomically, stamps the
-- signature date, and appends an append-only event carrying the actor name, IP,
-- user agent and the sha256 hash of the acknowledged document. Returns a status
-- code the route maps to token_invalid / token_expired / already_responded / ok.
--
-- STAGE 2 (0063): the studio hears it in the SAME transaction. After the flip,
-- one in-app notification per owner / admin / project_manager member of the
-- contract's org (kind `client_responded`, body `client_contract_signed`,
-- entity `contract` + its id, params {number, year}: the contract's number and
-- its creation year in Africa/Cairo, the year C-YYYY-NNNN shows). No other role
-- and never the `client` role. No email. A flip happens once per contract, so
-- there is nothing to deduplicate; a repeat answers 'already' before this.
--
-- LOCK TIMEOUT (A3 reliability R2), as the delivery token writes
-- (50-delivery-write.sql): the flip waits at most 4 s on a studio transaction
-- holding the contract row (an issue, a paper signature, a terminate), then the
-- call fails with 55P03 and rolls back whole, well before the app's 15 s
-- database deadline. So the client is answered in about 4 s and nothing of this
-- call commits after that answer. The setting holds only inside this function;
-- the caller's own lock_timeout is restored on exit.
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
set lock_timeout = '4s'
as $$
declare
  st  text;
  exp timestamptz;
  cid uuid;
  oid uuid;
  cnum integer;
  cyear integer;
  n   int;
begin
  select status, share_expires_at, id, org_id, number,
         extract(year from created_at at time zone 'Africa/Cairo')::int
    into st, exp, cid, oid, cnum, cyear
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

  insert into public.notifications
    (org_id, recipient_user_id, kind, entity_type, entity_id, body_key, params)
  select oid, m.user_id, 'client_responded', 'contract', cid, 'client_contract_signed',
         jsonb_build_object('number', cnum, 'year', cyear)
    from public.memberships m
   where m.org_id = oid
     and m.role::text in ('owner', 'admin', 'project_manager');

  return 'ok';
end
$$;

-- Same-transaction lockdown, as for app_contract_by_token above.
revoke all on function public.app_contract_ack_by_token(text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_contract_ack_by_token(text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_contract_ack_by_token(text, text, text, text, text) to metra_app;
  end if;
end
$$;

-- Public share: fetch a variation order by its token hash as a JSON document.
-- SECURITY DEFINER (the token IS the authorization; no session). Only issued /
-- approved / rejected VOs are visible. OMITS every cost/margin column. Currency
-- is inherited from the parent contract. netDelta (may be negative) is shown.
-- contract_active tells the reader whether the parent contract still carries
-- commercial change: termination rejects open VOs, so without it the portal
-- would read status='rejected' and tell the client THEY rejected the order.
--
-- STAGE 2 (0063), ADDITIVE: `tax_rate` and `supervision_pct` (the parent
-- contract's, as scale-4 STRINGS: an approved change order is charged works +
-- VAT + supervision, owner decision D4a), `time_extension_days` (null = none) and
-- `contract_source` ('proposal' or 'boq'). An app that does not know a key
-- ignores it, so the deploy is safe in either order.
--
-- DB STEP B (B5 D1), ADDITIVE in the same way: `contract_end_date` (the parent
-- contract's end_date, `YYYY-MM-DD` or null) and `time_extension_days_total`
-- (the days ALL of the contract's APPROVED change orders add, this one
-- included once approved; the same sum as app_contract_by_token's), so /v can
-- show the revised finish date (lib/execution/finish-date.ts).
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
    'tax_rate', c.tax_rate::text,
    'supervision_pct', c.supervision_pct::text,
    'time_extension_days', v.time_extension_days,
    'contract_source', case when c.source_boq_id is not null then 'boq' else 'proposal' end,
    'contract_end_date', to_char(c.end_date, 'YYYY-MM-DD'),
    'time_extension_days_total', coalesce((
      select sum(a.time_extension_days)
      from public.variation_orders a
      where a.org_id = c.org_id and a.contract_id = c.id and a.status = 'approved'
    ), 0),
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

-- Same-transaction lockdown, as for app_contract_by_token above.
revoke all on function public.app_variation_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.app_variation_by_token(text) from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_variation_by_token(text) to metra_app;
  end if;
end
$$;

-- Public share: record a client's approve/reject decision on a variation order.
-- Flips issued->approved|rejected atomically + appends an append-only event with
-- the actor name/IP/user agent. Returns a code the route maps to
-- token_invalid / token_expired / already_responded / ok.
--
-- STAGE 2 (0063): the studio hears it in the SAME transaction: one in-app
-- notification per owner / admin / project_manager member (kind
-- `client_responded`, body `client_variation_approved` or
-- `client_variation_rejected`, entity `contract` + the PARENT contract's id so
-- the feed opens the contract, params {number, year}: the CHANGE ORDER's number
-- and its creation year in Africa/Cairo, the year VO-YYYY-NNNN shows). A
-- decision flips once, so there is nothing to deduplicate.
--
-- DB STEP B (A5 reliability, /v versus termination): the PARENT CONTRACT is
-- locked FOR SHARE before the order is touched, and its status is read again
-- under that lock. Termination (lib/contracts/lifecycle/terminate.ts) holds the
-- contract FOR UPDATE and then rejects every open order in the same
-- transaction, so the two are serialised in that one order (contract, then
-- order): an approval that waits for a termination reads `terminated` and
-- answers `contract_inactive`, and never approves an order of a contract that
-- is gone; one that commits first is approved before the termination, which
-- then finds the order decided. Two client decisions share the lock and meet
-- on the order row, as before.
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
  cid    uuid;
  vnum   integer;
  vyear  integer;
  n      int;
begin
  target := case
    when p_decision = 'approve' then 'approved'
    when p_decision = 'reject'  then 'rejected'
    else null
  end;
  if target is null then return 'invalid'; end if;

  select v.status, v.share_expires_at, v.id, v.org_id, c.status::text, c.id, v.number,
         extract(year from v.created_at at time zone 'Africa/Cairo')::int
    into st, exp, vid, oid, cst, cid, vnum, vyear
    from public.variation_orders v
    join public.contracts c on c.id = v.contract_id and c.org_id = v.org_id
    where v.token_hash = p_hash;
  if not found then return 'not_found'; end if;
  select c.status::text into cst
    from public.contracts c
   where c.org_id = oid and c.id = cid
   for share;
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

  insert into public.notifications
    (org_id, recipient_user_id, kind, entity_type, entity_id, body_key, params)
  select oid, m.user_id, 'client_responded', 'contract', cid,
         case target when 'approved' then 'client_variation_approved' else 'client_variation_rejected' end,
         jsonb_build_object('number', vnum, 'year', vyear)
    from public.memberships m
   where m.org_id = oid
     and m.role::text in ('owner', 'admin', 'project_manager');

  return 'ok';
end
$$;

-- Same-transaction lockdown, as for app_contract_by_token above.
revoke all on function public.app_variation_respond_by_token(text, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_variation_respond_by_token(text, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_variation_respond_by_token(text, text, text, text, text) to metra_app;
  end if;
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
