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
  --
  -- Round B: only a LIVE client event repeats. One the studio retracted (an
  -- event_correction points at it) answers nothing, exactly as liveEvents()
  -- drops it in the studio's TS rule. A retracted row can still hold the unique
  -- slot this insert would take; the insert then hits unique_violation and
  -- answers `already`, and app_delivery_by_token does not offer that verb.
  if exists (
    select 1 from public.engagement_events ee
    where ee.engagement_id = eid and ee.actor_channel = 'client'
      and not exists (
        select 1 from public.engagement_events c
        where c.org_id = ee.org_id and c.supersedes_event_id = ee.id
      )
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

-- Round B (0056; 0057): the client CHOOSES one concept option, by share token.
-- SECURITY DEFINER (the token IS the auth; no session), the same posture as
-- app_delivery_respond_by_token: it appends ONE client `concept_approval` that
-- names the chosen `concept_option` artifact in `chosen_artifact_id` and SAVES
-- the letter the client saw in `chosen_position`, moves no state, adds no
-- guard and touches no money. The studio still advances.
--
-- It is the respond function's `approve_concept` with a pointer, so it shares
-- that verb's decision group: ONE live client concept decision per delivery.
-- A live (not retracted) client approval or change request answers `already`,
-- and so does a retracted client concept approval, because it still holds the
-- write's slot in the 0049 unique index on (engagement_id, kind) for unstamped
-- client rows (app_delivery_by_token stops offering the verb for the same
-- reason). That check runs BEFORE the option is looked at, so a stale double
-- submit answers `already` even after the studio hid the option. The row lock
-- serialises the check and the insert; the unique index is the backstop.
--
-- THE OPTION AND ITS LETTER (0057). p_position is the letter the client SAW
-- (1 = A to 4 = D). The write is accepted only when app_concept_option_positions,
-- the one lettering rule app_delivery_by_token also reads, puts p_artifact_id at
-- exactly p_position NOW; the position is then saved on the row, so the letter
-- never changes when the studio later hides or releases options. If the studio
-- changed the options between the client's page load and the tap, the letter
-- no longer matches and the answer is `wrong_state` (the portal says the options
-- changed and refreshes), never a choice under a letter the client did not see.
-- Anything else (another delivery's artifact, a render, a hidden option, a
-- forged uuid, a position outside 1 to 4) also answers `wrong_state`, never a
-- different code, so the function is no oracle for which artifact ids exist.
--
-- THE CALLER'S name/ip/ua are capped exactly like app_delivery_comment_by_token
-- (120 / 45 / 512): this function is the trust boundary for what reaches the
-- append-only ledger. Codes: ok | already | expired | not_active | wrong_state |
-- invalid
--
-- THE DROP. 0056's version took six arguments and had no p_position. No
-- deployed code ever called it (the B12 portal is its first caller), so it is
-- dropped rather than left as an overload that could save a choice without the
-- letter the client saw (the pairs CHECK would refuse that insert anyway).
-- CREATE OR REPLACE cannot add an argument: a new signature is a new function.
drop function if exists public.app_delivery_choose_concept_by_token(text, uuid, text, text, text, text);
create or replace function public.app_delivery_choose_concept_by_token(
  p_hash text,
  p_artifact_id uuid,
  p_position integer,
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
  -- Locked BEFORE the checks: the state, the decision pre-check and the
  -- option's letter must still hold at the INSERT.
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

  if exists (
    select 1 from public.engagement_events ee
    where ee.engagement_id = eid and ee.actor_channel = 'client'
      and ee.kind in ('concept_approval', 'concept_change_request')
      and (
        -- the slot this insert would take (retracted or not)
        (ee.kind = 'concept_approval' and ee.acknowledged_issue_at is null)
        -- or any LIVE decision: nothing retracts it (liveEvents() in TS)
        or not exists (
          select 1 from public.engagement_events c
          where c.org_id = ee.org_id and c.supersedes_event_id = ee.id
        )
      )
  ) then
    return 'already';
  end if;

  if p_position is null or p_position not between 1 and 4 then
    return 'wrong_state';
  end if;
  if not exists (
    select 1 from public.app_concept_option_positions(eid) p
    where p.artifact_id = p_artifact_id and p.option_position = p_position
  ) then
    return 'wrong_state';
  end if;

  begin
    insert into public.engagement_events
      (id, org_id, engagement_id, kind, actor_channel, actor_name, actor_ip,
       actor_user_agent, note, chosen_artifact_id, chosen_position)
      values (
        gen_random_uuid(), oid, eid, 'concept_approval', 'client',
        nullif(left(btrim(coalesce(p_name, '')), 120), ''),
        nullif(left(coalesce(p_ip, ''), 45), ''),
        nullif(left(coalesce(p_ua, ''), 512), ''),
        left(p_note, 2000), p_artifact_id, p_position
      );
  exception when unique_violation then
    return 'already';
  end;

  update public.design_engagements set updated_at = now() where id = eid;
  return 'ok';
end
$$;

-- Closed in the SAME implicit transaction as the CREATE above. A new function
-- is executable by PUBLIC (and, on Supabase, by the API roles through default
-- privileges) from the moment it exists; roles.sql revokes that too, but it
-- runs three files later, in its own transaction. This leaves no window. The
-- metra_app grant is guarded because on a fresh database roles.sql, which
-- creates that role, has not run yet.
revoke all on function public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text) to metra_app;
  end if;
end
$$;

-- Round B (0056; 0057): tell the STUDIO that the client just acted, by share token.
-- SECURITY DEFINER because the client has no session, and because the
-- notifications SELECT policy is recipient-scoped: collapsing a repeat into
-- another member's unread row is impossible from the app's own role.
--
-- p_body_key  one of the NINE client-act keys listed in v_allowed below (the
--             message keys PR-B7 renders); anything else answers null.
-- p_params    a JSON object of at most 2048 bytes, merged UNDER the delivery's
--             own number, year and titles (which always win). SQL NULL and JSON
--             `null` both mean "no extra params". A caller's `optionPosition` is
--             dropped: for `client_concept_chosen` the letter is read from the
--             saved choice row (0057), never taken from the caller.
-- p_roles     a JSON array of member_role labels. The app computes it from the
--             permission matrix at call time; nothing here hard-codes who
--             hears about what. The `client` role is never notified.
--
-- THE CALLER CONTRACT (PR-B10). This function trusts its caller for WHAT
-- happened, so the caller must:
--   * build the key, the role list and the params from a SERVER-SIDE map keyed
--     on the act it just performed, never from request input;
--   * call it only AFTER the client's write function returned `ok`, or on an
--     `already` for which app_delivery_act_notified_by_token answered false
--     (the R3 repair of a lost notification, 0057); never on a refusal, never
--     on any other `already`, and for an `already` the act notified is the
--     decision actually on file, not the one the repeat request named;
--   * never return `new_recipients` or `locale` to the portal (they are the
--     studio's member ids and setting); the portal learns only whether
--     notified_count > 0.
-- The one other caller is app_notify_lost_client_acts (Round C, 0058), the
-- hourly repair: it calls this only for an act that the shared anchor rule
-- dates inside its window and that no notification answers, with the act's
-- own key, the milestone it names and the role list the app gave for that key.
--
-- DEDUPE (0057): ONE UNREAD notification per (recipient, delivery, body key,
-- milestone). `milestone` is `p_params.milestoneKind`, which only
-- `client_payment_claimed` carries; for every other key it is null, so the key
-- is (recipient, delivery, body key) as before. A claim on the deposit and one
-- on gate_a are two acts the studio confirms separately, so they are two rows
-- (and two emails), not one row with count 2. A repeat while the matching row
-- is unread bumps `params.count` and moves `created_at` to now (so it rises to
-- the top of the feed) instead of adding a row; once the recipient has read
-- it, the next act inserts a fresh one. A transaction-scoped advisory lock per
-- (recipient, delivery, body key, milestone) makes two concurrent acts land
-- one row with count 2, not two rows.
--
-- THE YEAR in the params is the delivery's creation year in Africa/Cairo, the
-- studio's local time, which is the year the app's DE-YYYY-NNNN shows its users
-- (docYear() formats in the browser's local time).
--
-- RETURNS null when the key, the role list or the params are malformed or too
-- large, or when no LIVE link matches (the same share_expires_at rule as
-- app_delivery_by_token). Otherwise:
--   { engagement_id, locale (the studio's default_locale), notified_count (rows
--     inserted or bumped), new_recipients (user ids that got a NEW row, the only
--     ones the app emails), number, year (Cairo), title_ar, title_en (0057: the
--     delivery's identity, so the app's email label needs no second read) }
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
  v_allowed constant text[] := array[
    'client_concept_approved',
    'client_concept_chosen',
    'client_concept_changes_requested',
    'client_design_approved',
    'client_design_changes_requested',
    'client_budget_acknowledged',
    'client_handover_acknowledged',
    'client_payment_claimed',
    'client_commented'
  ];
  v_params          jsonb;
  v_milestone       text;
  v_engagement_id   uuid;
  v_org_id          uuid;
  v_locale          text;
  v_number          integer;
  v_year            integer;
  v_title_ar        text;
  v_title_en        text;
  v_position        smallint;
  v_base            jsonb;
  v_member          record;
  v_existing_id     uuid;
  v_existing_params jsonb;
  v_count           integer;
  v_notified        integer := 0;
  v_new_recipients  jsonb := '[]'::jsonb;
begin
  if p_body_key is null or not (p_body_key = any (v_allowed)) then
    return null;
  end if;
  if p_roles is null or jsonb_typeof(p_roles) <> 'array' then return null; end if;
  if p_params is null or jsonb_typeof(p_params) = 'null' then
    v_params := '{}'::jsonb;
  elsif jsonb_typeof(p_params) <> 'object' or octet_length(p_params::text) > 2048 then
    return null;
  else
    v_params := p_params;
  end if;
  -- The letter of a chosen option is read from the saved row below, never
  -- taken from the caller.
  v_params := v_params - 'optionPosition';
  v_milestone := v_params ->> 'milestoneKind';

  -- The delivery's own identity always overrides a same-named caller param.
  select de.id, de.org_id, o.default_locale, de.number,
         extract(year from de.created_at at time zone 'Africa/Cairo')::int,
         de.title_ar, de.title_en
    into v_engagement_id, v_org_id, v_locale, v_number, v_year, v_title_ar,
         v_title_en
    from public.design_engagements de
    join public.organizations o on o.id = de.org_id
   where de.token_hash = p_hash
     and (de.share_expires_at is null or de.share_expires_at > now());
  if not found then return null; end if;
  v_base := v_params || jsonb_build_object(
    'number', v_number,
    'year', v_year,
    'titleAr', v_title_ar,
    'titleEn', v_title_en
  );

  -- 0057: a chosen option's notification carries the letter SAVED with the
  -- newest live client choice (the one the client saw), so the studio reads
  -- "option B" exactly as the client did.
  if p_body_key = 'client_concept_chosen' then
    select e.chosen_position
      into v_position
      from public.engagement_events e
     where e.engagement_id = v_engagement_id
       and e.actor_channel = 'client'
       and e.kind = 'concept_approval'
       and e.chosen_position is not null
       and not exists (
         select 1 from public.engagement_events x
         where x.org_id = e.org_id and x.supersedes_event_id = e.id
       )
     order by e.decided_at desc
     limit 1;
    if v_position is not null then
      v_base := v_base || jsonb_build_object('optionPosition', v_position);
    end if;
  end if;

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
        || ':' || p_body_key || ':' || coalesce(v_milestone, ''),
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
       and (n.params ->> 'milestoneKind') is not distinct from v_milestone
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
    'new_recipients', v_new_recipients,
    'number', v_number,
    'year', v_year,
    'title_ar', v_title_ar,
    'title_en', v_title_en
  );
end
$$;

-- Same-transaction lockdown as the choice function above, for the same reason.
revoke all on function public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_notify_studio_by_token(text, text, jsonb, jsonb) to metra_app;
  end if;
end
$$;

-- Round C (0058): WHEN did the client act this notification body key reports
-- happen? THE ONE ANCHOR RULE, read by app_delivery_act_notified_by_token (the
-- repeat-tap repair, R3) and app_notify_lost_client_acts (the hourly sweep), so
-- the two can never disagree about which act a notification answers. The rule
-- is B12's predicate table, moved here verbatim, plus one key (client channel;
-- a row an event_correction retracts does not count):
--   client_concept_approved          newest client concept_approval naming no option
--   client_concept_chosen            newest client concept_approval naming an option
--   client_concept_changes_requested newest client concept_change_request
--   client_design_approved /         newest client decision of that kind in the
--   client_design_changes_requested    CURRENT render round (the respond
--                                      function's own round predicate)
--   client_budget_acknowledged       client rom_acknowledgement of the current issuance
--   client_handover_acknowledged     newest client handoff_acknowledgement
--   client_payment_claimed           the PENDING claim of p_milestone_kind (its created_at)
--   client_commented                 newest client comment on any document (0058;
--                                      only the sweep asks for it: the R3 predicate
--                                      answers null for a comment, as it did in B12)
-- Any other key, an unknown delivery, or no anchor row: null.
--
-- INTERNAL. It takes a bare engagement id, so it is revoked from public, the
-- API roles AND metra_app, and only the two definer functions in this file call
-- it (they have already proven the token or the org). SECURITY INVOKER: under
-- those callers it runs with their rights; nobody else may run it at all. It
-- reads no money column (a claim's created_at only) and returns one instant.
create or replace function public.app_client_act_anchor(
  p_engagement_id uuid,
  p_org_id uuid,
  p_body_key text,
  p_milestone_kind text
)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  ri      timestamptz;
  rr      timestamptz;
  anchor  timestamptz;
begin
  select rom_issued_at, renders_ready_at
    into ri, rr
    from public.design_engagements
   where id = p_engagement_id
     and org_id = p_org_id;
  if not found then return null; end if;

  if p_body_key = 'client_payment_claimed' then
    select max(pc.created_at)
      into anchor
      from public.client_payment_claims pc
     where pc.engagement_id = p_engagement_id
       and pc.org_id = p_org_id
       and pc.milestone_kind::text = p_milestone_kind
       and pc.status = 'pending';
  elsif p_body_key = 'client_commented' then
    select max(dc.created_at)
      into anchor
      from public.engagement_document_comments dc
     where dc.engagement_id = p_engagement_id
       and dc.org_id = p_org_id
       and dc.author_channel = 'client';
  elsif p_body_key in (
    'client_concept_approved', 'client_concept_chosen',
    'client_concept_changes_requested', 'client_design_approved',
    'client_design_changes_requested', 'client_budget_acknowledged',
    'client_handover_acknowledged'
  ) then
    select max(e.decided_at)
      into anchor
      from public.engagement_events e
     where e.engagement_id = p_engagement_id
       and e.org_id = p_org_id
       and e.actor_channel = 'client'
       and not exists (
         select 1 from public.engagement_events x
         where x.org_id = e.org_id and x.supersedes_event_id = e.id
       )
       and case p_body_key
         when 'client_concept_approved' then
           e.kind = 'concept_approval' and e.chosen_artifact_id is null
         when 'client_concept_chosen' then
           e.kind = 'concept_approval' and e.chosen_artifact_id is not null
         when 'client_concept_changes_requested' then
           e.kind = 'concept_change_request'
         when 'client_budget_acknowledged' then
           e.kind = 'rom_acknowledgement'
           and e.acknowledged_issue_at is not distinct from ri
         when 'client_handover_acknowledged' then
           e.kind = 'handoff_acknowledgement'
         else
           e.kind = case p_body_key
             when 'client_design_approved' then 'design_approval'
             else 'design_change_request'
           end::public.engagement_event_kind
           and (
             e.acknowledged_issue_at is not distinct from rr
             or (e.acknowledged_issue_at is null and rr is not null
                 and e.decided_at >= rr)
           )
       end;
  else
    return null;
  end if;
  return anchor;
end
$$;

-- Closed in the SAME implicit transaction as the CREATE above, and to EVERY
-- caller role: unlike the token functions, metra_app gets no grant. Its two
-- callers are SECURITY DEFINER functions, which run it as their owner.
revoke all on function public.app_client_act_anchor(uuid, uuid, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'metra_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_client_act_anchor(uuid, uuid, text, text) from %I',
        r
      );
    end if;
  end loop;
end
$$;

-- Round B (0057): was THIS client act's studio notification ever written?
-- The safety net for a lost notification. A client write function answers
-- `already` on a repeat tap; if the notifier failed on the first `ok` (a
-- timeout, a dropped connection), the studio was never told. On `already` the
-- portal asks this predicate and notifies only when it answers false, so a
-- repeat tap repairs the loss and an ordinary repeat sends nothing twice.
--
-- THE ANCHOR is the act the write's `already` pointed at, by body key, from
-- app_client_act_anchor above (Round C, 0058: the rule moved there unchanged so
-- the hourly sweep reads the same one). A comment has no anchor HERE: this
-- predicate answers null for client_commented exactly as it did in B12.
-- It then answers whether a `client_responded` notification with that body key
-- (and, for a payment claim, that milestone) was written or bumped at or after
-- the anchor, for ANY recipient, read or not. Sound because the notifier always
-- writes (or bumps created_at to now on) its row in a LATER transaction than
-- the act it reports.
--
-- RETURNS null when no live link matches (the same share_expires_at rule as
-- app_delivery_by_token), when the key has no anchor rule (client_commented, an
-- unknown key) or when no anchor row exists; the caller then does not notify.
-- Otherwise true or false. It reads no money column (a claim's created_at only)
-- and returns nothing but that boolean, so it is no oracle beyond "the studio
-- was told". STABLE: it only reads. Signature, result and answers unchanged
-- since 0057.
create or replace function public.app_delivery_act_notified_by_token(
  p_hash text,
  p_body_key text,
  p_milestone_kind text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  eid     uuid;
  oid     uuid;
  anchor  timestamptz;
begin
  select id, org_id
    into eid, oid
    from public.design_engagements
   where token_hash = p_hash
     and (share_expires_at is null or share_expires_at > now());
  if not found then return null; end if;

  if p_body_key = 'client_commented' then return null; end if;
  anchor := public.app_client_act_anchor(eid, oid, p_body_key, p_milestone_kind);
  if anchor is null then return null; end if;

  return exists (
    select 1 from public.notifications n
     where n.org_id = oid
       and n.kind = 'client_responded'
       and n.entity_type = 'engagement'
       and n.entity_id = eid
       and n.body_key = p_body_key
       and (p_body_key <> 'client_payment_claimed'
            or n.params ->> 'milestoneKind' = p_milestone_kind)
       and n.created_at >= anchor
  );
end
$$;

-- Same-transaction lockdown as the choice function above, for the same reason.
revoke all on function public.app_delivery_act_notified_by_token(text, text, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_act_notified_by_token(text, text, text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_act_notified_by_token(text, text, text) to metra_app;
  end if;
end
$$;

-- Round C (0058): WHICH delivery does a client's handover confirmation close?
-- By share token, for the portal's inline close right after the client taps
-- "I received it" (the client has no session, so the app needs the org to
-- resolve its system actor, and the delivery to name to the executor). The
-- executor still runs the edge's role gate, guards and atomic state move; this
-- only says where to point it.
--
-- RETURNS { org_id, engagement_id } when a LIVE link matches (the same
-- share_expires_at rule as app_delivery_by_token), the delivery is at
-- design_only_handoff, and a LIVE client handoff_acknowledgement exists (one an
-- event_correction retracts does not count, exactly as liveEvents() drops it).
-- Otherwise null: an unknown, revoked or expired token, any other state
-- (including closed), and no live acknowledgement all look the same. It reads
-- no money column. STABLE: it only reads. Locked down right below.
create or replace function public.app_delivery_close_target_by_token(p_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  eid  uuid;
  oid  uuid;
  st   text;
begin
  select id, org_id, state
    into eid, oid, st
    from public.design_engagements
   where token_hash = p_hash
     and (share_expires_at is null or share_expires_at > now());
  if not found then return null; end if;
  if st <> 'design_only_handoff' then return null; end if;
  if not exists (
    select 1 from public.engagement_events e
     where e.engagement_id = eid
       and e.org_id = oid
       and e.actor_channel = 'client'
       and e.kind = 'handoff_acknowledgement'
       and not exists (
         select 1 from public.engagement_events x
         where x.org_id = e.org_id and x.supersedes_event_id = e.id
       )
  ) then
    return null;
  end if;
  return jsonb_build_object('org_id', oid, 'engagement_id', eid);
end
$$;

-- Same-transaction lockdown as the choice function above, for the same reason.
revoke all on function public.app_delivery_close_target_by_token(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_delivery_close_target_by_token(text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_delivery_close_target_by_token(text) to metra_app;
  end if;
end
$$;

-- Round C (0058): the hourly repair of studio notifications LOST on a client's
-- first tap. A client act and its notification are two transactions (the write
-- commits, then the portal calls the notifier); if the second one fails (a
-- timeout, a dropped connection) and the client never taps again, the studio is
-- never told. The acts themselves are the outbox: this function finds acts in
-- a window that no notification answers, and notifies them through THE notifier
-- (app_delivery_notify_studio_by_token), so the dedupe, the recipients and the
-- params are exactly the ones a first tap produces.
--
-- WHO MAY CALL. The hourly runner, inside the org's own transaction: the caller
-- must have set app.current_org_id and app.current_user_id (withOrgContext) and
-- that user must be an OWNER or ADMIN member of that org (the runner's system
-- actor is). Anything else returns null. Every read and write is scoped to that
-- one org; another tenant's acts are never seen.
--
-- THE WINDOW. Only acts whose anchor (app_client_act_anchor, the SAME rule the
-- repeat-tap repair reads) lies in [p_since, p_until]. The caller passes
-- now - 48 h and now - 10 min: an act younger than 10 minutes is left to the
-- portal's own notify, so the sweep never races a first tap; one older than 48
-- hours is not dug up. p_since < p_until <= now() and a window of at most 7
-- days, else null.
--
-- LOST MEANS: no `client_responded` notification for that delivery and body key
-- (and, for a payment claim, that milestone) was written or bumped at or after
-- the anchor, for any recipient, read or not. The predicate of
-- app_delivery_act_notified_by_token, so the sweep and the repeat tap agree. A
-- repaired act therefore has a notification at or after its anchor, and the
-- next sweep finds nothing: no act is notified twice by the sweep. (A repeat
-- tap repairing the same act in the same instant meets the notifier's own
-- per-recipient lock and bumps the unread row's count; it adds no row and no
-- email.)
--
-- THE KEYS. The nine client-act keys the notifier allows; client_payment_claimed
-- is asked once per milestone (deposit, gate_a, gate_b, balance), because the
-- notifier keeps one row per milestone. p_roles is a JSON object mapping each
-- body key to the member_role array the app's permission matrix gives that act;
-- `p_roles -> key` is handed to the notifier unchanged. A key whose array is
-- missing, malformed, or names no role a (non-client) member of the org holds
-- is skipped before any work: it would notify nobody, so it never spends one
-- of the 50 calls and never repeats hour after hour. The notifier never
-- notifies the client role, so this function can message nobody but studio
-- members, and it sends no email itself (the app emails the notifier's
-- new_recipients, as on a first tap).
--
-- WHICH DELIVERIES. This org's deliveries with a live link (the notifier needs
-- one) and updated_at >= p_since. The second condition is a bound, not a rule
-- change: every client write (respond, claim, choose, comment) refreshes
-- updated_at in the transaction that writes the act, and nothing moves
-- updated_at backwards, so a delivery with an act in the window always passes.
-- Oldest updated_at first, so an act about to leave the window is repaired
-- first.
--
-- BOUNDED: at most 50 notifier calls per call; the rest wait for the next hour.
-- RETURNS a JSON array, one entry per notifier call:
--   { body_key, milestone_kind (null unless a payment claim), notified (the
--     notifier's answer, which carries engagement_id, locale, new_recipients) }
-- or `[]` when nothing was lost. The raw token hash never leaves this function.
-- It reads no money column. VOLATILE: the notifier writes.
create or replace function public.app_notify_lost_client_acts(
  p_since timestamptz,
  p_until timestamptz,
  p_roles jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] := array[
    'client_concept_approved',
    'client_concept_chosen',
    'client_concept_changes_requested',
    'client_design_approved',
    'client_design_changes_requested',
    'client_budget_acknowledged',
    'client_handover_acknowledged',
    'client_payment_claimed',
    'client_commented'
  ];
  v_milestones constant text[] := array['deposit', 'gate_a', 'gate_b', 'balance'];
  v_max_calls  constant integer := 50;
  v_org        uuid;
  v_user       uuid;
  v_delivery   record;
  v_key        text;
  v_milestone  text;
  v_anchor     timestamptz;
  v_notified   jsonb;
  v_calls      integer := 0;
  v_result     jsonb := '[]'::jsonb;
  v_heard_keys text[];
begin
  v_org := nullif(current_setting('app.current_org_id', true), '')::uuid;
  v_user := nullif(current_setting('app.current_user_id', true), '')::uuid;
  if v_org is null or v_user is null then return null; end if;
  if not exists (
    select 1 from public.memberships m
     where m.org_id = v_org
       and m.user_id = v_user
       and m.role::text in ('owner', 'admin')
  ) then
    return null;
  end if;
  if p_roles is null or jsonb_typeof(p_roles) <> 'object' then return null; end if;
  if p_since is null or p_until is null
     or p_since >= p_until
     or p_until > now()
     or p_until - p_since > interval '7 days' then
    return null;
  end if;

  -- The keys someone in this org would actually hear about: the role map
  -- names a member_role array for the key, and a non-client member of the org
  -- holds one of those roles (the notifier's own recipient rule). A key that
  -- resolves to nobody is skipped BEFORE any work and spends no notifier call,
  -- so a bad or partial map can never starve the 50-call bound.
  select coalesce(array_agg(k.key), '{}')
    into v_heard_keys
    from unnest(v_keys) as k(key)
   where case
     when jsonb_typeof(p_roles -> k.key) = 'array' then exists (
       select 1 from public.memberships m
        where m.org_id = v_org
          and m.role::text <> 'client'
          and m.role::text in (select jsonb_array_elements_text(p_roles -> k.key))
     )
     else false
   end;

  for v_delivery in
    select de.id, de.token_hash
      from public.design_engagements de
     where de.org_id = v_org
       and de.token_hash is not null
       and (de.share_expires_at is null or de.share_expires_at > now())
       and de.updated_at >= p_since
     order by de.updated_at, de.id
  loop
    foreach v_key in array v_heard_keys loop
      foreach v_milestone in array (
        case when v_key = 'client_payment_claimed' then v_milestones
             else array[null]::text[] end
      ) loop
        v_anchor := public.app_client_act_anchor(v_delivery.id, v_org, v_key, v_milestone);
        continue when v_anchor is null or v_anchor < p_since or v_anchor > p_until;
        continue when exists (
          select 1 from public.notifications n
           where n.org_id = v_org
             and n.kind = 'client_responded'
             and n.entity_type = 'engagement'
             and n.entity_id = v_delivery.id
             and n.body_key = v_key
             and (v_milestone is null or n.params ->> 'milestoneKind' = v_milestone)
             and n.created_at >= v_anchor
        );
        if v_calls >= v_max_calls then return v_result; end if;
        v_notified := public.app_delivery_notify_studio_by_token(
          v_delivery.token_hash,
          v_key,
          case when v_milestone is null then '{}'::jsonb
               else jsonb_build_object('milestoneKind', v_milestone) end,
          p_roles -> v_key
        );
        v_calls := v_calls + 1;
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'body_key', v_key,
          'milestone_kind', v_milestone,
          'notified', v_notified
        ));
      end loop;
    end loop;
  end loop;
  return v_result;
end
$$;

-- Same-transaction lockdown as the choice function above, for the same reason.
revoke all on function public.app_notify_lost_client_acts(timestamptz, timestamptz, jsonb) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_notify_lost_client_acts(timestamptz, timestamptz, jsonb) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_notify_lost_client_acts(timestamptz, timestamptz, jsonb) to metra_app;
  end if;
end
$$;

-- Round B (0056) — a share link's nonce never outlives its hash. The trigger
-- (policies/40-engagements.sql, trg_design_engagements_token_nonce) runs this
-- BEFORE every UPDATE of design_engagements: when token_hash changes (to a new
-- link or to NULL) and the statement did not set token_nonce itself, the old
-- nonce is cleared. So code that has never heard of the nonce (a build from
-- before Round B, a Worker rolled back past it, a hand-written fix) can rotate
-- or revoke without tripping design_engagements_token_nonce_needs_hash, and a
-- rotated link is never left paired with the nonce of the link it replaced.
-- A writer that sets the nonce in the same statement (the Round B mint and
-- rotate) keeps the value it wrote. Invoker rights, empty search_path: it only
-- edits the row being written.
create or replace function public.clear_token_nonce_on_hash_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.token_hash is distinct from OLD.token_hash
     and NEW.token_nonce is not distinct from OLD.token_nonce then
    NEW.token_nonce := null;
  end if;
  return NEW;
end
$$;
