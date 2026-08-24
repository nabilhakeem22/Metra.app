-- DEPRECATED for hot paths — prefer the declarative composite FK from
-- sameOrgFk() (packages/db/src/schema/org-ref.ts): (org_id, <name>_id) ->
-- target(org_id, id) enforces same-org at the DB with no per-row trigger.
-- Reserve enforce_same_org for non-composite / cross-schema targets only.
--
-- Reusable trigger function for composite same-org foreign keys. Not attached to
-- any table in P0 (no child business tables exist yet), but shipped so P1+ child
-- tables can guarantee a referenced row lives in the same org as the referrer.
--
-- Usage on a future table:
--   create trigger trg_lines_same_org
--     before insert or update on public.proposal_lines
--     for each row execute function enforce_same_org('proposals', 'proposal_id');
--   -- args: [0] referenced table (public schema), [1] this table's FK column.

create or replace function public.enforce_same_org()
returns trigger
language plpgsql
as $$
declare
  ref_table text := TG_ARGV[0];
  fk_column text := TG_ARGV[1];
  fk_value  uuid;
  ref_org   uuid;
begin
  fk_value := (to_jsonb(NEW) ->> fk_column)::uuid;
  if fk_value is null then
    return NEW;
  end if;

  execute format('select org_id from public.%I where id = $1', ref_table)
    into ref_org
    using fk_value;

  if ref_org is null then
    raise exception
      'enforce_same_org: referenced % row % not found', ref_table, fk_value;
  end if;

  if ref_org <> NEW.org_id then
    raise exception
      'enforce_same_org: cross-org reference blocked on %.% -> %',
      TG_TABLE_NAME, fk_column, ref_table;
  end if;

  return NEW;
end
$$;

-- Bootstrap lookup for requireOrg: resolve which org(s) the CURRENT authenticated
-- user belongs to BEFORE any org context exists. SECURITY DEFINER runs as the
-- owner (postgres, BYPASSRLS) so it is not filtered by FORCE RLS, but it is
-- tightly scoped to exactly `app.current_user_id` — it can never return another
-- user's rows and never widens org visibility (no permissive policy on the
-- business table). empty search_path forces fully-qualified names.
create or replace function public.app_current_user_memberships()
returns table (org_id uuid, role public.member_role)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, m.role
  from public.memberships m
  where m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Invitation lookup by token hash, BEFORE any org context exists (the accept
-- flow does not know which org it is until it resolves the token). SECURITY
-- DEFINER bypasses FORCE RLS but returns at most the single row matching the
-- exact token hash — no enumeration, no widening. The caller re-validates
-- status/expiry/email and only then enters that org's context.
create or replace function public.app_invitation_by_token(p_token_hash text)
returns table (
  id uuid,
  org_id uuid,
  email text,
  role public.member_role,
  status public.invitation_status,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.org_id, i.email, i.role, i.status, i.expires_at
  from public.invitations i
  where i.token_hash = p_token_hash
$$;

-- The current user's orgs (with role + display names), for the org switcher and
-- requireOrg's active-org validation. SECURITY DEFINER, scoped to
-- app.current_user_id — returns only the caller's own memberships, no widening.
create or replace function public.app_current_user_orgs()
returns table (
  org_id uuid,
  role public.member_role,
  name_ar text,
  name_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, m.role, o.name_ar, o.name_en
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- ===========================================================================
-- Membership second factor for RLS. These run inside the request transaction
-- (as metra_app, which is granted execute) and read the request GUCs. SECURITY
-- DEFINER so they can consult memberships/invitations WITHOUT being filtered by
-- the very policies they support (no recursion). Each is tightly scoped to the
-- session's own org/user/email — never widens visibility.
-- ===========================================================================

-- Is the session user a member of the current org? Used in every table's USING.
create or replace function public.app_is_current_org_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id  = nullif(current_setting('app.current_org_id',  true), '')::uuid
      and m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

-- May the session user create their OWN founding/accepted membership? True only
-- when (a) the org has NO members yet (createOrg founding owner), or (b) the
-- session user has an ACCEPTED invitation in this org matching their email
-- (acceptInvite). This is the ONLY bootstrap carve-out; it is scoped to the
-- caller's own user/email so it can never become a self-join backdoor.
create or replace function public.app_can_bootstrap_membership()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1 from public.memberships m
      where m.org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    )
    or exists (
      select 1 from public.invitations i
      where i.org_id      = nullif(current_setting('app.current_org_id',   true), '')::uuid
        and i.status      = 'accepted'
        and i.accepted_by = nullif(current_setting('app.current_user_id',  true), '')::uuid
        and lower(i.email) = lower(nullif(current_setting('app.current_user_email', true), ''))
    );
$$;

-- Atomically claim a pending invitation for the session user (marks it accepted
-- with accepted_by=current user). Returns the id iff it was claimed. Guarded to
-- the current org + the invite email matching the session email. VOLATILE.
-- Dropped first because the return type changed from an earlier setof uuid form
-- (create or replace cannot change a function's return type). No policy depends
-- on this function, so the drop is safe.
drop function if exists public.app_claim_invitation(uuid);
create or replace function public.app_claim_invitation(p_invitation_id uuid)
returns table (id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.invitations
     set status = 'accepted',
         accepted_by = nullif(current_setting('app.current_user_id', true), '')::uuid,
         accepted_at = now(),
         updated_at = now()
   where id = p_invitation_id
     and status = 'pending'
     and org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
     and lower(email) = lower(nullif(current_setting('app.current_user_email', true), ''))
   returning id;
$$;

-- Account bootstrap (Epic A, A1). Mint ONE fresh, UNLINKED account row and return
-- its id — this is the ONLY code path that creates an account. createOrg calls it,
-- then stamps the new org's account_id; the 1:1 backfill migration seeded existing
-- orgs. SECURITY DEFINER so the insert runs as the BYPASSRLS owner: the accounts
-- policy's `with check (false)` refuses every metra_app INSERT, so accounts can be
-- created ONLY here. Scoped to nothing but the two name args — it neither reads nor
-- widens any tenant's data. Mirrors the app_claim_invitation shape (returns
-- table(id)). Least-privilege grants (metra_app only) live in roles.sql.
create or replace function public.app_bootstrap_account(
  p_name_ar text,
  p_name_en text
)
returns table (id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.accounts (name_ar, name_en)
  values (p_name_ar, p_name_en)
  returning id;
$$;

-- =============================================================================
-- P1 Slice 3 — Proposals
-- =============================================================================

-- Child-draft guard: proposal_sections / proposal_lines may only be
-- inserted/updated/deleted while their parent proposal is still 'draft'. Once a
-- proposal is sent (or beyond), its lines are frozen. SECURITY DEFINER so the
-- status lookup is not itself RLS-filtered. Raises MT100 on a frozen change.
-- A cascade delete of a DRAFT proposal still passes (parent is draft at BEFORE
-- DELETE time).
create or replace function public.enforce_proposal_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   jsonb;
  pid uuid;
  st  text;
begin
  if TG_OP = 'DELETE' then j := to_jsonb(OLD); else j := to_jsonb(NEW); end if;

  if TG_TABLE_NAME = 'proposal_sections' then
    pid := (j ->> 'proposal_id')::uuid;
  else
    select proposal_id into pid
      from public.proposal_sections
      where id = (j ->> 'section_id')::uuid;
  end if;

  select status into st from public.proposals where id = pid;
  if st is not null and st <> 'draft' then
    raise exception
      'proposal children are frozen once the proposal leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end
$$;

-- Public share: fetch a proposal by its token hash as a nested JSON document.
-- SECURITY DEFINER (the token IS the authorization; no session). Only sent /
-- accepted / rejected proposals are visible. OMITS every cost/margin column
-- (unit_cost, line_cost, line_margin, total_cost, total_margin) — a client must
-- never see the firm's cost basis.
create or replace function public.app_proposal_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'number', p.number,
    'status', p.status,
    'title_ar', p.title_ar,
    'title_en', p.title_en,
    'currency', p.currency,
    'issue_date', p.issue_date,
    'expiry_date', p.expiry_date,
    'discount_pct', p.discount_pct,
    'tax_rate', p.tax_rate,
    'subtotal', p.subtotal,
    'discount_amount', p.discount_amount,
    'taxable_base', p.taxable_base,
    'tax_amount', p.tax_amount,
    'total', p.total,
    'notes_ar', p.notes_ar,
    'notes_en', p.notes_en,
    'terms_ar', p.terms_ar,
    'terms_en', p.terms_en,
    'share_expires_at', p.share_expires_at,
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
                from public.proposal_lines l
                where l.section_id = s.id
              ) lx
            ), '[]'::jsonb)
          ) as sec
        from public.proposal_sections s
        where s.proposal_id = p.id
      ) sx
    ), '[]'::jsonb)
  )
  from public.proposals p
  join public.organizations o on o.id = p.org_id
  where p.token_hash = p_hash
    and p.status in ('sent', 'accepted', 'rejected');
$$;

-- Public share: record a client's accept/reject decision. Returns a status code
-- the route maps to token_invalid / token_expired / already_responded / ok.
create or replace function public.app_proposal_respond_by_token(
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
  pid    uuid;
  oid    uuid;
  cid    uuid;
  n      int;
begin
  target := case
    when p_decision = 'accept' then 'accepted'
    when p_decision = 'reject' then 'rejected'
    else null
  end;
  if target is null then return 'invalid'; end if;

  select status, share_expires_at, id, org_id, client_id
    into st, exp, pid, oid, cid
    from public.proposals
    where token_hash = p_hash;
  if not found then return 'not_found'; end if;
  if st <> 'sent' then return 'already'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;

  update public.proposals
    set status = target::public.proposal_status, updated_at = now()
    where id = pid and status = 'sent';
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;

  insert into public.proposal_events
    (id, org_id, proposal_id, kind, actor_name, ip, user_agent, from_status, to_status)
    values (gen_random_uuid(), oid, pid, target, p_name, p_ip, p_ua, 'sent', target);

  -- On acceptance, append to the client's activity feed (system event). The
  -- function is SECURITY DEFINER, so this insert runs as the owner (bypasses the
  -- unauthenticated FORCE-RLS on activities, exactly like proposal_events above).
  if target = 'accepted' then
    insert into public.activities
      (id, org_id, entity_type, entity_id, actor_user_id, kind, note, meta)
      values (gen_random_uuid(), oid, 'client', cid, null, 'proposal_accepted', null,
              jsonb_build_object('proposal_id', pid));
  end if;

  return 'ok';
end
$$;

-- =============================================================================
-- Public API keys (v1) — live-role resolver
-- =============================================================================

-- Resolve a public API key by its sha256 token hash, BEFORE any org context
-- exists (the request only carries a Bearer key). SECURITY DEFINER bypasses FORCE
-- RLS but returns at most the single matching key — and ONLY when it is LIVE:
--   * not revoked (revoked_at is null)
--   * not expired (expires_at is null or in the future)
--   * its creator (created_by) is a CURRENT member of the key's org
-- The role returned is the creator's LIVE membership role (an INNER JOIN on
-- memberships), so a role change is reflected immediately and losing membership
-- resolves the key to null (the caller maps that to 401). Cost/margin visibility
-- is NOT stored here — it is derived per-request from canSeeMargin(role, ...).
create or replace function public.app_api_key_by_hash(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key_id', k.id,
    'org_id', k.org_id,
    'principal_user_id', k.created_by,
    'role', m.role
  )
  from public.api_keys k
  join public.memberships m
    on m.org_id = k.org_id
   and m.user_id = k.created_by
  where k.token_hash = p_hash
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > now());
$$;

-- Throttled last_used_at stamp. SECURITY DEFINER (called before org context) but
-- scoped to the exact key hash; updates only when the stored value is null or
-- older than the passed cutoff, so there is no DB write per request. Returns
-- nothing meaningful; best-effort via ctx.waitUntil on the caller.
create or replace function public.app_touch_api_key(p_hash text, p_cutoff timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.api_keys
     set last_used_at = now()
   where token_hash = p_hash
     and (last_used_at is null or last_used_at < p_cutoff);
$$;

-- =============================================================================
-- P1 Slice 4 — Contracts + Variation Orders
-- =============================================================================

-- Child-draft guard: contract_sections / contract_lines may only be
-- inserted/updated/deleted while their parent contract is still 'draft'. Both
-- carry contract_id (lines denormalize it), so the lookup is direct. SECURITY
-- DEFINER so the status read is not itself RLS-filtered. Raises MT100 on a frozen
-- change. A cascade delete of a DRAFT contract still passes (parent is draft at
-- BEFORE DELETE time).
create or replace function public.enforce_contract_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   jsonb;
  cid uuid;
  st  text;
begin
  if TG_OP = 'DELETE' then j := to_jsonb(OLD); else j := to_jsonb(NEW); end if;
  cid := (j ->> 'contract_id')::uuid;
  select status into st from public.contracts where id = cid;
  if st is not null and st <> 'draft' then
    raise exception
      'contract children are frozen once the contract leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end
$$;

-- Child-draft guard: variation_order_lines may only be inserted/updated/deleted
-- while their parent VO is still 'draft'. Once a VO is internally approved (or
-- beyond) its lines and netDelta are frozen. Raises MT100 on a frozen change.
create or replace function public.enforce_variation_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j   jsonb;
  vid uuid;
  st  text;
begin
  if TG_OP = 'DELETE' then j := to_jsonb(OLD); else j := to_jsonb(NEW); end if;
  vid := (j ->> 'variation_order_id')::uuid;
  select status into st from public.variation_orders where id = vid;
  if st is not null and st <> 'draft' then
    raise exception
      'variation order lines are frozen once the VO leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
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
  join public.contracts c on c.id = v.contract_id
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
  n      int;
begin
  target := case
    when p_decision = 'approve' then 'approved'
    when p_decision = 'reject'  then 'rejected'
    else null
  end;
  if target is null then return 'invalid'; end if;

  select status, share_expires_at, id, org_id
    into st, exp, vid, oid
    from public.variation_orders
    where token_hash = p_hash;
  if not found then return 'not_found'; end if;
  if st <> 'issued' then return 'already'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;

  update public.variation_orders
    set status = target::public.variation_status, updated_at = now()
    where id = vid and status = 'issued';
  get diagnostics n = row_count;
  if n = 0 then return 'already'; end if;

  insert into public.variation_order_events
    (id, org_id, variation_order_id, kind, actor_name, ip, user_agent, from_status, to_status)
    values (gen_random_uuid(), oid, vid, target, p_name, p_ip, p_ua, 'issued', target);

  return 'ok';
end
$$;
