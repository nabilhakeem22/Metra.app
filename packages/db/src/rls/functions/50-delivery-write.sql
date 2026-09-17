-- rls/functions/50-delivery-write.sql — the client delivery portal, WRITE half.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

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
--   acknowledge_rom         -> rom_acknowledgement     (rom_low AND rom_high set
--                              AND rom_issued_at stamped; snapshots the current
--                              band into range_low/range_high)
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
  ri        timestamptz;
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

  -- acknowledge_rom ALONE takes the row lock, and takes it BEFORE the read: its
  -- precondition is that the band is issued, and a concurrent setEngagementRom
  -- clears rom_issued_at, so an unlocked read could witness the client's consent
  -- to a band that stopped existing between the check and the INSERT. The other
  -- verbs gate on `state`, which the engagement's own transitions serialise.
  if p_action = 'acknowledge_rom' then
    perform 1 from public.design_engagements where token_hash = p_hash for update;
  end if;

  select state, share_expires_at, id, org_id, rom_low, rom_high, rom_issued_at
    into st, exp, eid, oid, rl, rh, ri
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
    -- An unissued band is not acknowledgeable: falls through to 'wrong_state',
    -- the same answer the client already gets for any verb offered too early.
    when 'acknowledge_rom'         then rl is not null and rh is not null
                                        and ri is not null
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
        -- 0049: a ROM acknowledgement is per ISSUANCE, not per engagement. Only
        -- an acknowledgement of THIS issuance instant is a repeat; one against a
        -- superseded band (or a legacy NULL) leaves the verb open.
        when v_kind = 'rom_acknowledgement'
          then ee.kind = v_kind and ee.acknowledged_issue_at is not distinct from ri
        else ee.kind = v_kind
      end
  ) then
    return 'already';
  end if;

  begin
    insert into public.engagement_events
      (id, org_id, engagement_id, kind, actor_channel, actor_name, actor_ip,
       actor_user_agent, note, range_low, range_high, acknowledged_issue_at)
      values (
        gen_random_uuid(), oid, eid, v_kind, 'client', p_name, p_ip, p_ua,
        left(p_note, 2000),
        case when v_kind = 'rom_acknowledgement' then rl else null end,
        case when v_kind = 'rom_acknowledgement' then rh else null end,
        -- 0049: WHICH issuance this answers. `ri` was read under the row lock
        -- taken above, so it is the same instant the precondition checked.
        case when v_kind = 'rom_acknowledgement' then ri else null end
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
