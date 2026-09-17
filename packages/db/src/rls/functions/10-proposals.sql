-- rls/functions/10-proposals.sql — proposals: the child-draft guard and the public token surface.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- P1 Slice 3 — Proposals
-- =============================================================================

-- Child-draft guard: proposal_sections / proposal_lines may only be
-- inserted/updated/deleted while their parent proposal is still 'draft'. Once a
-- proposal is sent (or beyond), its lines are frozen. SECURITY DEFINER so the
-- status lookup is not itself RLS-filtered. Raises MT100 on a frozen change.
-- A cascade delete of a DRAFT proposal still passes (parent is draft at BEFORE
-- DELETE time).
--
-- BOTH PARENTS ARE CHECKED ON UPDATE, which is what this guard was missing until
-- wave 7. Reading only NEW's status admitted
--
--     update public.proposal_sections set proposal_id = '<a DRAFT proposal>'
--      where id = '<a section of a SENT proposal>'
--
-- and the `proposal_lines.section_id` twin of it, because the status read was of
-- the DRAFT target. `proposals` itself is never touched, so
-- `trg_proposals_immutable` does not fire either, and metra_app holds `update`
-- on both child tables. The sent document silently loses a section while its
-- cached subtotal / taxable_base / total stay at the sent figures - which is the
-- number the client is looking at. No product path writes either column today;
-- this is the future action, script or backfill the trigger exists for, and it
-- is the same hole `enforce_boq_child_draft` closed in wave 6.
--
-- THE TWO ATTACHED TABLES REACH THE PROPOSAL BY DIFFERENT COLUMNS
-- (`proposal_sections.proposal_id`, `proposal_lines.section_id` -> its section's
-- proposal), so the row is read through `to_jsonb` rather than as `OLD.<col>`:
-- a direct field reference to a column the OTHER table does not have would raise
-- at runtime the first time this trigger fired on it. The BOQ and contract twins
-- read their column directly precisely because both of THEIR tables carry it.
create or replace function public.enforce_proposal_child_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_pid uuid;
  new_pid uuid;
  st      text;
begin
  -- The parent the row is LEAVING (UPDATE) or being removed from (DELETE).
  -- OLD is NULL on INSERT, hence the guard.
  if TG_OP <> 'INSERT' then
    if TG_TABLE_NAME = 'proposal_sections' then
      old_pid := (to_jsonb(OLD) ->> 'proposal_id')::uuid;
    else
      select proposal_id into old_pid
        from public.proposal_sections
        where id = (to_jsonb(OLD) ->> 'section_id')::uuid;
    end if;

    select status into st from public.proposals where id = old_pid;
    if st is not null and st <> 'draft' then
      raise exception
        'proposal children are frozen once the proposal leaves draft (status=%)', st
        using errcode = 'MT100';
    end if;

    if TG_OP = 'DELETE' then return OLD; end if;
  end if;

  -- The parent the row is ARRIVING at: an INSERT, or an UPDATE that re-parents.
  if TG_TABLE_NAME = 'proposal_sections' then
    new_pid := (to_jsonb(NEW) ->> 'proposal_id')::uuid;
  else
    select proposal_id into new_pid
      from public.proposal_sections
      where id = (to_jsonb(NEW) ->> 'section_id')::uuid;
  end if;

  -- An UPDATE that does not move the row has only one parent, already read.
  if TG_OP = 'UPDATE' and new_pid is not distinct from old_pid then return NEW; end if;

  select status into st from public.proposals where id = new_pid;
  if st is not null and st <> 'draft' then
    raise exception
      'proposal children are frozen once the proposal leaves draft (status=%)', st
      using errcode = 'MT100';
  end if;
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
