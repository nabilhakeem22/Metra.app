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
--
-- Round B (0056). A DESIGN decision answers ONE render issuance, the
-- engagement's `renders_ready_at`, which every `rendersReady` re-stamps after a
-- revision. The row records that instant in `acknowledged_issue_at` (the column
-- 0049 introduced for the same idea on the ROM band), so after a revision the
-- client is asked to approve again. A legacy design decision with no stamp still
-- counts for the current round when it was made at or after `renders_ready_at`;
-- one made before it belongs to an earlier round. With no `renders_ready_at` at
-- all (legacy), the decision is one per delivery, as before. The same predicate
-- is in app_delivery_by_token's `client_actions` and in the studio's TS rule
-- (lib/engagements/client-review.ts), so the three cannot disagree.
--
-- Every successful write also refreshes `design_engagements.updated_at`, so the
-- studio's newest-first lists surface the delivery the client just acted on.
-- Signature and return type are unchanged since Phase 2.
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
  rr        timestamptz;
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

  -- The row lock, taken BEFORE the read, for acknowledge_rom and for every
  -- DECISION verb. acknowledge_rom: its precondition is that the band is issued,
  -- and a concurrent setEngagementRom clears rom_issued_at, so an unlocked read
  -- could witness the client's consent to a band that stopped existing between
  -- the check and the INSERT. The decisions: approve and request-changes are
  -- two KINDS, so the partial unique indexes cannot stop one of each landing in
  -- the same round from two tabs; serialising on the delivery row makes the
  -- `already` pre-check below see the first one. It also pins renders_ready_at
  -- for the duration, so the round a decision records is the round it checked.
  -- acknowledge_handoff gates only on `state`, which the transitions serialise.
  if p_action <> 'acknowledge_handoff' then
    perform 1 from public.design_engagements where token_hash = p_hash for update;
  end if;

  select state, share_expires_at, id, org_id, rom_low, rom_high, rom_issued_at,
         renders_ready_at
    into st, exp, eid, oid, rl, rh, ri, rr
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
        -- Round B: a design decision is per RENDER ISSUANCE. A decision stamped
        -- with this round's instant repeats; so does a legacy unstamped one made
        -- at or after it. With no issuance at all both sides are NULL and the
        -- first branch keeps the old one-per-delivery rule.
        when v_kind in ('design_approval', 'design_change_request')
          then ee.kind in ('design_approval', 'design_change_request')
           and (
             ee.acknowledged_issue_at is not distinct from rr
             or (ee.acknowledged_issue_at is null and rr is not null
                 and ee.decided_at >= rr)
           )
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
        -- 0049: WHICH issuance this answers. `ri` and `rr` were read under the
        -- row lock taken above, so each is the instant the pre-check compared.
        case
          when v_kind = 'rom_acknowledgement' then ri
          when v_kind in ('design_approval', 'design_change_request') then rr
          else null
        end
      );
  exception when unique_violation then
    return 'already';
  end;

  update public.design_engagements set updated_at = now() where id = eid;
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

  -- Round B: a client act refreshes the delivery's updated_at (see the respond
  -- function above). Only on a real insert: `already` returned before this.
  update public.design_engagements set updated_at = now() where id = eid;
  return 'ok';
end
$$;

-- Round B (0056) — the client CHOOSES one concept option, by share token.
-- SECURITY DEFINER (the token IS the auth; no session), the same posture as
-- app_delivery_respond_by_token: it appends ONE client `concept_approval` that
-- names the chosen `concept_option` artifact in `chosen_artifact_id`, moves no
-- state, adds no guard and touches no money. The studio still advances.
--
-- It is the respond function's `approve_concept` with a pointer, so it shares
-- that verb's decision group: ONE client concept decision per delivery. A prior
-- client approval OR change request answers `already`, and so does a concurrent
-- double submit (the row lock below serialises the pre-check, and the 0049
-- partial unique index on (engagement_id, kind) for unstamped client rows is
-- the backstop).
--
-- The artifact must be an OPTION THE CLIENT CAN SEE on THIS delivery: same
-- engagement, same org, kind `concept_option`, released (`client_visible`), and
-- carrying a file. Anything else (another delivery's artifact, a render, a
-- hidden option, a forged uuid) answers `wrong_state`, never a different code,
-- so the function is no oracle for which artifact ids exist. Codes:
--   ok | already | expired | not_active | wrong_state | invalid
create or replace function public.app_delivery_choose_concept_by_token(
  p_hash text,
  p_artifact_id uuid,
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
  st   text;
  exp  timestamptz;
  eid  uuid;
  oid  uuid;
begin
  -- Locked BEFORE the checks: the state and the decision pre-check must still
  -- hold at the INSERT.
  select state, share_expires_at, id, org_id
    into st, exp, eid, oid
    from public.design_engagements
    where token_hash = p_hash
    for update;
  if not found then return 'invalid'; end if;
  if exp is not null and exp <= now() then return 'expired'; end if;
  if st in ('closed_design_only', 'execution', 'abandoned') then
    return 'not_active';
  end if;
  if st <> 'concept_review' then return 'wrong_state'; end if;

  if not exists (
    select 1
      from public.engagement_artifacts a
      join public.files f on f.id = a.file_id and f.org_id = a.org_id
     where a.id = p_artifact_id
       and a.engagement_id = eid
       and a.org_id = oid
       and a.kind = 'concept_option'
       and a.client_visible
  ) then
    return 'wrong_state';
  end if;

  if exists (
    select 1 from public.engagement_events ee
    where ee.engagement_id = eid and ee.actor_channel = 'client'
      and ee.kind in ('concept_approval', 'concept_change_request')
  ) then
    return 'already';
  end if;

  begin
    insert into public.engagement_events
      (id, org_id, engagement_id, kind, actor_channel, actor_name, actor_ip,
       actor_user_agent, note, chosen_artifact_id)
      values (
        gen_random_uuid(), oid, eid, 'concept_approval', 'client', p_name, p_ip,
        p_ua, left(p_note, 2000), p_artifact_id
      );
  exception when unique_violation then
    return 'already';
  end;

  update public.design_engagements set updated_at = now() where id = eid;
  return 'ok';
end
$$;

-- Round B (0056) — tell the STUDIO that the client just acted, by share token.
-- Called by the portal action AFTER one of the write functions above answered
-- `ok`. SECURITY DEFINER because the client has no session, and because the
-- notifications SELECT policy is recipient-scoped: collapsing a repeat into
-- another member's unread row is impossible from the app's own role.
--
-- p_body_key  the notification's message key; must match ^client_[a-z_]{1,60}$.
-- p_params    a JSON object merged UNDER the delivery's own number, year and
--             titles (which always win), or null.
-- p_roles     a JSON array of member_role labels. The app computes it from the
--             permission matrix at call time; nothing here hard-codes who
--             hears about what. The `client` role is never notified.
--
-- DEDUPE: ONE UNREAD notification per (recipient, delivery, body key). A repeat
-- while that row is unread bumps `params.count` and moves `created_at` to now
-- (so it rises to the top of the feed) instead of adding a row; once the
-- recipient has read it, the next act inserts a fresh one. A transaction-scoped
-- advisory lock per (recipient, delivery, body key) makes two concurrent acts
-- land one row with count 2, not two rows.
--
-- RETURNS null when the key or the role list is malformed, when p_params is not
-- an object, or when no LIVE link matches (the same share_expires_at rule as
-- app_delivery_by_token). Otherwise:
--   { engagement_id, locale (the studio's default_locale), notified_count (rows
--     inserted or bumped), new_recipients (user ids that got a NEW row, the only
--     ones the app emails) }
-- It reads and returns no money and no pricing column.
create or replace function public.app_delivery_notify_studio_by_token(
  p_hash text,
  p_body_key text,
  p_params jsonb,
  p_roles jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_engagement_id   uuid;
  v_org_id          uuid;
  v_locale          text;
  v_base            jsonb;
  v_member          record;
  v_existing_id     uuid;
  v_existing_params jsonb;
  v_count           integer;
  v_notified        integer := 0;
  v_new_recipients  jsonb := '[]'::jsonb;
begin
  if p_body_key is null or p_body_key !~ '^client_[a-z_]{1,60}$' then
    return null;
  end if;
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' then return null; end if;
  if p_params is not null and jsonb_typeof(p_params) <> 'object' then
    return null;
  end if;

  -- The delivery's own identity always overrides a same-named caller param.
  -- The year is read in UTC, the clock the Worker formats DE numbers with.
  select de.id, de.org_id, o.default_locale,
         coalesce(p_params, '{}'::jsonb) || jsonb_build_object(
           'number', de.number,
           'year', extract(year from de.created_at at time zone 'UTC')::int,
           'titleAr', de.title_ar,
           'titleEn', de.title_en
         )
    into v_engagement_id, v_org_id, v_locale, v_base
    from public.design_engagements de
    join public.organizations o on o.id = de.org_id
   where de.token_hash = p_hash
     and (de.share_expires_at is null or de.share_expires_at > now());
  if not found then return null; end if;

  for v_member in
    select m.user_id
      from public.memberships m
     where m.org_id = v_org_id
       and m.role::text in (select jsonb_array_elements_text(p_roles))
       and m.role::text <> 'client'
     order by m.user_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'notification:' || v_member.user_id::text || ':' || v_engagement_id::text
        || ':' || p_body_key,
      0
    ));

    -- FOR UPDATE re-checks `read_at is null` if the recipient is marking the
    -- row read right now: a row read meanwhile is not bumped, a new one lands.
    select n.id, n.params
      into v_existing_id, v_existing_params
      from public.notifications n
     where n.org_id = v_org_id
       and n.recipient_user_id = v_member.user_id
       and n.kind = 'client_responded'
       and n.entity_type = 'engagement'
       and n.entity_id = v_engagement_id
       and n.body_key = p_body_key
       and n.read_at is null
     order by n.created_at desc
     limit 1
     for update;

    if found then
      v_count := case
        when jsonb_typeof(v_existing_params -> 'count') = 'number'
          then floor((v_existing_params ->> 'count')::numeric)::integer
        else 1
      end;
      update public.notifications
         set params = v_base || jsonb_build_object('count', v_count + 1),
             created_at = now(),
             updated_at = now()
       where id = v_existing_id;
    else
      insert into public.notifications
        (org_id, recipient_user_id, kind, entity_type, entity_id, body_key, params)
        values (
          v_org_id, v_member.user_id, 'client_responded', 'engagement',
          v_engagement_id, p_body_key, v_base || jsonb_build_object('count', 1)
        );
      v_new_recipients := v_new_recipients || jsonb_build_array(v_member.user_id);
    end if;
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'engagement_id', v_engagement_id,
    'locale', v_locale,
    'notified_count', v_notified,
    'new_recipients', v_new_recipients
  );
end
$$;
