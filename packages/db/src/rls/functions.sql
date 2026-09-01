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

-- The current user's orgs (with role, display names + owning account), for the
-- org switcher and requireOrg's active-org validation. SECURITY DEFINER, scoped
-- to app.current_user_id — returns only the caller's own memberships, no widening.
-- Dropped first because the return type gained account columns (A3): create or
-- replace cannot change a function's return type. The signature (name + 0 args)
-- is unchanged, so roles.sql re-grants/re-revokes it after this file runs (DROP
-- resets privileges). LEFT JOIN so an org not yet linked to an account still
-- returns, with account_* NULL. No policy depends on this function.
drop function if exists public.app_current_user_orgs();
create or replace function public.app_current_user_orgs()
returns table (
  org_id uuid,
  role public.member_role,
  name_ar text,
  name_en text,
  account_id uuid,
  account_name_ar text,
  account_name_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id, m.role, o.name_ar, o.name_en, a.id, a.name_ar, a.name_en
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  left join public.accounts a on a.id = o.account_id
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

-- =============================================================================
-- Client Delivery Portal (P1) — session-less read snapshot
-- =============================================================================

-- Public share: fetch ONE design delivery by its token hash as a client-safe JSON
-- snapshot. SECURITY DEFINER — the token IS the authorization (no session, no org
-- GUC). Resolves exactly the one delivery whose token_hash = p_hash, and only
-- while the link is live (share_expires_at is null OR in the future). A revoked
-- link (token_hash set to null) can never match a non-null p_hash, so revoke =>
-- null => the portal 404s.
--
-- COST-SAFE BY CONSTRUCTION. This function PHYSICALLY selects ONLY the columns
-- enumerated below — every cost/margin/build-cost/token/internal column is simply
-- never referenced (omission, not a filter), mirroring app_proposal_by_token.
--
-- Columns exposed (the WHOLE surface):
--   design_engagements: id, number, state (raw key — the TS layer maps to a
--     client-friendly label), off_plan, title_ar, title_en, created_at,
--     design_fee (as design_fee_total — the fee the CLIENT pays, not a cost),
--     rom_low, rom_high (the client-acknowledged budget band), share_expires_at
--   organizations (the firm): name_ar, name_en, logo_file_id
--   clients (the end client): name_ar, name_en
--   engagement_milestones: kind, basis, sort_order, value (only as an input to
--     the client's amount_due — the raw basis value is not leaked as cost)
--   payment_events: amount (aggregated per kind into amount_cleared)
--   engagement_artifacts (Client Deliverables Step 1, only where client_visible):
--     id, kind, updated_at (as shared_at). `label`, `note`, `content_hash`,
--     `attested_by` and files.original_name/size_bytes are NOT exposed — an
--     internal label or filename can itself be sensitive. `files` is joined only to
--     prove a downloadable object exists; no column of it is returned.
--
-- PHYSICALLY OMITTED (never referenced): design_engagements.render_manifest_hash,
--   renders_ready_at, revision_count, free_revision_n, design_revision_count,
--   free_design_revision_n, as_built_due,
--   concept_locked_at, token_hash, updated_at, org_id, client_id, project_id;
--   payment_events.method/reference/note/recorded_by/idempotency_key; every
--   proposal/contract/cost_item cost column (unit_cost/line_cost/total_cost/
--   *_margin/supervision/BOQ build cost) — none are in this query's tables and
--   none are joined in. No actor / internal-notes field is exposed.
create or replace function public.app_delivery_by_token(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', de.id,
    'number', de.number,
    'state', de.state,
    'off_plan', de.off_plan,
    'title_ar', de.title_ar,
    'title_en', de.title_en,
    'created_at', de.created_at,
    'design_fee_total', de.design_fee::text,
    'rom', case
      when de.rom_low is null and de.rom_high is null then null
      else jsonb_build_object('low', de.rom_low::text, 'high', de.rom_high::text)
    end,
    'share_expires_at', de.share_expires_at,
    'firm', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id
    ),
    'client', jsonb_build_object(
      'name_ar', c.name_ar,
      'name_en', c.name_en
    ),
    'payment_schedule', coalesce((
      select jsonb_agg(ms order by ms_sort)
      from (
        select m.sort_order as ms_sort,
          jsonb_build_object(
            'milestone_kind', m.kind,
            'basis', m.basis,
            'amount_due', due.amount::text,
            -- scale-4 for both branches (the `0` literal would otherwise render "0")
            'amount_cleared', coalesce(cl.cleared, 0)::numeric(18, 4)::text,
            'status', case
              when coalesce(cl.cleared, 0) >= due.amount then 'paid'
              when coalesce(cl.cleared, 0) > 0 then 'partial'
              else 'due'
            end
          ) as ms
        from public.engagement_milestones m
        cross join lateral (
          select case
            when m.basis = 'percent'
              then round(coalesce(de.design_fee, 0) * m.value / 100, 4)
            else m.value
          end as amount
        ) due
        left join lateral (
          select sum(pe.amount) as cleared
          from public.payment_events pe
          where pe.engagement_id = de.id
            and pe.kind::text = m.kind::text
        ) cl on true
        where m.engagement_id = de.id
      ) mx
    ), '[]'::jsonb),
    -- Client Delivery Portal Phase 2 — the verbs the client MAY act on right now.
    -- Server-computed CLIENT-FACING tokens (approve_concept / request_concept_changes
    -- / approve_design / request_design_changes / acknowledge_rom / acknowledge_handoff)
    -- — NEVER a raw machine state name (S1). Each group appears only while its state
    -- is current AND no client signal of that kind exists yet, so a confirmed action
    -- drops off the list (the portal renders the confirmed state instead). Empty when
    -- nothing is actionable.
    'client_actions', (
      select coalesce(jsonb_agg(action order by ord), '[]'::jsonb)
      from (
        select 'approve_concept' as action, 1 as ord
        where de.state = 'concept_review'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('concept_approval', 'concept_change_request')
          )
        union all
        select 'request_concept_changes', 2
        where de.state = 'concept_review'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('concept_approval', 'concept_change_request')
          )
        union all
        select 'approve_design', 3
        where de.state = 'final_approval'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('design_approval', 'design_change_request')
          )
        union all
        select 'request_design_changes', 4
        where de.state = 'final_approval'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('design_approval', 'design_change_request')
          )
        union all
        select 'acknowledge_rom', 5
        where de.rom_low is not null
          and de.rom_high is not null
          and de.state not in ('closed_design_only', 'execution', 'abandoned')
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind = 'rom_acknowledgement'
          )
        union all
        select 'acknowledge_handoff', 6
        where de.state = 'design_only_handoff'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind = 'handoff_acknowledgement'
          )
      ) acts
    ),
    -- Client Delivery Portal Phase 3 — the milestones the client MAY "mark as paid"
    -- right now. Computed from the SAME price-blind milestone-due math as
    -- payment_schedule above: a milestone is claimable while its remaining due
    -- (amount_due − amount_cleared) is strictly positive. ANY unsettled milestone
    -- is claimable (owner-locked; NOT just the next-due one), so this is a LIST. Each
    -- entry carries the server-computed amount_remaining (scale-4 string — the amount
    -- is locked, the client never sends one) and whether an OPEN (pending) client
    -- claim already exists for it. It reads only engagement_milestones,
    -- payment_events and client_payment_claims — none of which expose the firm's
    -- private pricing (the AC4 test greps this function's source to enforce that).
    'claim', jsonb_build_object(
      'claimable_milestones', coalesce((
        select jsonb_agg(cm order by cm_sort)
        from (
          select m.sort_order as cm_sort,
            jsonb_build_object(
              'milestone_kind', m.kind,
              'amount_remaining',
                (due.amount - coalesce(cl.cleared, 0))::numeric(18, 4)::text,
              'has_pending_claim', exists (
                select 1 from public.client_payment_claims pc
                where pc.engagement_id = de.id
                  and pc.milestone_kind = m.kind
                  and pc.status = 'pending'
              )
            ) as cm
          from public.engagement_milestones m
          cross join lateral (
            select case
              when m.basis = 'percent'
                then round(coalesce(de.design_fee, 0) * m.value / 100, 4)
              else m.value
            end as amount
          ) due
          left join lateral (
            select sum(pe.amount) as cleared
            from public.payment_events pe
            where pe.engagement_id = de.id
              and pe.kind::text = m.kind::text
          ) cl on true
          where m.engagement_id = de.id
            and (due.amount - coalesce(cl.cleared, 0)) > 0
        ) cmx
      ), '[]'::jsonb)
    ),
    -- Client Deliverables Step 1 — the files the studio has RELEASED to this client.
    -- Only three fields cross the wire: the artifact id (the download route's filter
    -- within this already-proven delivery), its kind (mapped to a friendly category
    -- label in TS), and when it was shared. The internal label, the stored filename
    -- and the byte size are deliberately NOT exposed — a filename can carry the
    -- firm's internal naming. Rows without a joined file row are skipped (nothing to
    -- download); rows the studio has not released are excluded by a.client_visible.
    -- Newest share first, and BOUNDED to the 200 most recently attested rows so a
    -- delivery with a runaway artifact count can never turn one portal read into an
    -- unbounded aggregate (the whole snapshot is rebuilt on every request).
    --
    -- Step 2 adds ONE more field: `comment_count`, the size of that document's
    -- thread, so the portal can render "3 messages" on the row without fetching
    -- every thread up front (the thread itself is a separate, per-document SDF call
    -- made only when the client opens it). A count is not client data — it is a
    -- count of messages this same client can already read.
    'documents', coalesce((
      select jsonb_agg(d order by d_sort desc)
      from (
        select a.attested_at as d_sort,
          jsonb_build_object(
            'id', a.id,
            'kind', a.kind,
            'shared_at', a.updated_at,
            'comment_count', (
              select count(*) from public.engagement_document_comments dc
              where dc.artifact_id = a.id and dc.org_id = a.org_id
            )
          ) as d
        from public.engagement_artifacts a
        join public.files f on f.id = a.file_id and f.org_id = a.org_id
        where a.engagement_id = de.id and a.org_id = de.org_id and a.client_visible
        order by a.attested_at desc
        limit 200
      ) dx
    ), '[]'::jsonb)
  )
  from public.design_engagements de
  join public.organizations o on o.id = de.org_id
  join public.clients c on c.id = de.client_id
  where de.token_hash = p_hash
    and (de.share_expires_at is null or de.share_expires_at > now());
$$;

-- Client Delivery Portal Phase 2 — record a client's APPEND-ONLY ADVISORY SIGNAL
-- against a delivery by its share token. SECURITY DEFINER (the token IS the auth;
-- no session). This is the WRITABLE twin of app_delivery_by_token and mirrors
-- app_proposal_respond_by_token / app_contract_ack_by_token: it NEVER moves state,
-- NEVER adds a blocking guard, and NEVER touches money — the firm stays in control.
-- It appends ONE engagement_events row (actor_channel='client') witnessing the
-- client's approval / change-request / acknowledgement. Cost/margin is never read
-- or returned — the function yields only a status code:
--   ok | already | expired | not_active | wrong_state | invalid
-- Action -> (kind, required precondition):
--   approve_concept         -> concept_approval        (state = concept_review)
--   request_concept_changes -> concept_change_request  (state = concept_review)
--   approve_design          -> design_approval         (state = final_approval)
--   request_design_changes  -> design_change_request   (state = final_approval)
--   acknowledge_rom         -> rom_acknowledgement     (rom_low AND rom_high set;
--                              snapshots the current band into range_low/range_high)
--   acknowledge_handoff     -> handoff_acknowledgement (state = design_only_handoff)
-- A client rom_acknowledgement is the SAME kind the internal romAcknowledged guard
-- reads, so a portal ROM ack satisfies Gate B exactly like the staff-recorded one —
-- no new guard is introduced.
create or replace function public.app_delivery_respond_by_token(
  p_hash text,
  p_action text,
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
as $$
declare
  v_kind    public.engagement_event_kind;
  st        text;
  exp       timestamptz;
  eid       uuid;
  oid       uuid;
  rl        numeric;
  rh        numeric;
  ok_state  boolean;
begin
  -- Map the client-facing verb to the ledger event kind (unknown verb -> invalid).
  v_kind := case p_action
    when 'approve_concept'         then 'concept_approval'
    when 'request_concept_changes' then 'concept_change_request'
    when 'approve_design'          then 'design_approval'
    when 'request_design_changes'  then 'design_change_request'
    when 'acknowledge_rom'         then 'rom_acknowledgement'
    when 'acknowledge_handoff'     then 'handoff_acknowledgement'
    else null
  end::public.engagement_event_kind;
  if v_kind is null then return 'invalid'; end if;

  select state, share_expires_at, id, org_id, rom_low, rom_high
    into st, exp, eid, oid, rl, rh
    from public.design_engagements
    where token_hash = p_hash;
  if not found then return 'invalid'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;
  if st in ('closed_design_only', 'execution', 'abandoned') then
    return 'not_active';
  end if;

  -- Required precondition per action. Append-only either way: a change-request is a
  -- witness, NOT a state move — the firm decides what to do about it.
  ok_state := case p_action
    when 'approve_concept'         then st = 'concept_review'
    when 'request_concept_changes' then st = 'concept_review'
    when 'approve_design'          then st = 'final_approval'
    when 'request_design_changes'  then st = 'final_approval'
    when 'acknowledge_rom'         then rl is not null and rh is not null
    when 'acknowledge_handoff'     then st = 'design_only_handoff'
    else false
  end;
  if not ok_state then return 'wrong_state'; end if;

  -- At most one client DECISION per group per engagement: approve vs
  -- request-changes on the same concept (or design) are mutually exclusive — the
  -- read model + UI treat them as one decision, so the write path must too.
  -- ROM/handoff acks are per-kind. This pre-check + the partial UNIQUE index
  -- (0033, keyed on the decision group) make a concurrent double-click land
  -- exactly one row.
  if exists (
    select 1 from public.engagement_events ee
    where ee.engagement_id = eid and ee.actor_channel = 'client'
      and case
        when v_kind in ('concept_approval', 'concept_change_request')
          then ee.kind in ('concept_approval', 'concept_change_request')
        when v_kind in ('design_approval', 'design_change_request')
          then ee.kind in ('design_approval', 'design_change_request')
        else ee.kind = v_kind
      end
  ) then
    return 'already';
  end if;

  begin
    insert into public.engagement_events
      (id, org_id, engagement_id, kind, actor_channel, actor_name, actor_ip,
       actor_user_agent, note, range_low, range_high)
      values (
        gen_random_uuid(), oid, eid, v_kind, 'client', p_name, p_ip, p_ua,
        left(p_note, 2000),
        case when v_kind = 'rom_acknowledgement' then rl else null end,
        case when v_kind = 'rom_acknowledgement' then rh else null end
      );
  exception when unique_violation then
    return 'already';
  end;

  return 'ok';
end
$$;

-- Client Delivery Portal Phase 3 — a session-less client's "mark as paid" against a
-- delivery by its share token. SECURITY DEFINER (the token IS the auth; no session).
-- Mirrors app_delivery_respond_by_token: it NEVER moves state, NEVER adds a blocking
-- guard, and NEVER writes the real money ledger — the firm stays in control. It
-- APPENDS ONE `pending` row to client_payment_claims; the STUDIO later CONFIRMS it
-- from the cockpit (recordPaymentCore), and only that confirm writes payment_events.
--
-- COST-BLIND: the function reads only the milestone-due math (engagement_milestones,
-- payment_events) + the engagement's client-facing design_fee to LOCK the claimed
-- amount to the milestone's full remaining due server-side (the client never sends
-- an amount). It reads/returns NO cost/margin column. Yields only a status code:
--   ok | already | expired | not_active | wrong_state | invalid
-- ANY unsettled milestone (remaining due > 0) is claimable — this guards on "this
-- milestone is a real, unsettled milestone with remaining due > 0", NOT on "is it
-- the first unsettled". At most one OPEN claim per (engagement, milestone) — the
-- exists pre-check + the partial UNIQUE index (0034) make a double-click land one row.
create or replace function public.app_delivery_claim_payment_by_token(
  p_hash text,
  p_milestone_kind text,
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
as $$
declare
  st        text;
  exp       timestamptz;
  eid       uuid;
  oid       uuid;
  v_fee     numeric;
  v_remain  numeric;
begin
  select state, share_expires_at, id, org_id, design_fee
    into st, exp, eid, oid, v_fee
    from public.design_engagements
    where token_hash = p_hash;
  if not found then return 'invalid'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;
  if st in ('closed_design_only', 'execution', 'abandoned') then
    return 'not_active';
  end if;

  -- Unknown milestone kind -> wrong_state (the TOKEN is valid; only the requested
  -- milestone is unavailable). 'invalid' is reserved for a token-not-found (step 1),
  -- so the client never sees the misleading "this link is no longer available".
  if p_milestone_kind not in ('deposit', 'gate_a', 'gate_b', 'balance') then
    return 'wrong_state';
  end if;

  -- Remaining due for THAT milestone = amount_due − amount_cleared, in the SAME
  -- cost-blind math as app_delivery_by_token. NULL when the milestone doesn't exist
  -- on this engagement (no row) — mapped to wrong_state below.
  select
    (case
       when m.basis = 'percent'
         then round(coalesce(v_fee, 0) * m.value / 100, 4)
       else m.value
     end)
    - coalesce((
        select sum(pe.amount)
        from public.payment_events pe
        where pe.engagement_id = eid
          and pe.kind::text = m.kind::text
      ), 0)
    into v_remain
    from public.engagement_milestones m
    where m.engagement_id = eid
      and m.kind = p_milestone_kind::public.milestone_kind;

  -- Milestone absent for this engagement OR already settled (remaining ≤ 0).
  if v_remain is null or v_remain <= 0 then return 'wrong_state'; end if;

  -- One OPEN claim per milestone: a pending claim already exists -> idempotent no-op.
  if exists (
    select 1 from public.client_payment_claims pc
    where pc.engagement_id = eid
      and pc.milestone_kind = p_milestone_kind::public.milestone_kind
      and pc.status = 'pending'
  ) then
    return 'already';
  end if;

  -- INSERT-only: append the pending claim, amount LOCKED to the remaining due. The
  -- partial UNIQUE index (0034) is the concurrency backstop for the pre-check above.
  begin
    insert into public.client_payment_claims
      (id, org_id, engagement_id, milestone_kind, claimed_amount, status,
       actor_name, actor_ip, actor_user_agent, note)
      values (
        gen_random_uuid(), oid, eid,
        p_milestone_kind::public.milestone_kind,
        v_remain::numeric(18, 4), 'pending',
        p_name, p_ip, p_ua, left(p_note, 2000)
      );
  exception when unique_violation then
    return 'already';
  end;

  return 'ok';
end
$$;

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
    'original_name', f.original_name
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
  return 'ok';
end
$$;
