-- rls/functions/40-delivery-read.sql — the client delivery portal, READ half.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- Client Delivery Portal (P1) — session-less read snapshot
-- =============================================================================

-- Client Deliverables Step 3 — is EVERY scheduled milestone on this engagement fully
-- settled? True when no milestone has a positive remaining due, using the SAME
-- price-blind math as `payment_schedule` / `claim` in app_delivery_by_token
-- (percent milestones resolve against design_fee; `payment_events` of the matching
-- kind are the receipts). One declaration, called by every surface that gates a
-- deliverable on payment, so "settled" can never mean two different things.
--
-- A schedule with NO milestones is settled (nothing is owed) — the same
-- absent-milestone-is-a-free-gate rule the money guards already apply, so a
-- three-payment schedule that omits gate_a is unaffected.
--
-- SECURITY DEFINER + empty search_path, and takes an engagement id rather than a
-- token because its callers have already proven the token. It is REVOKED from
-- public in roles.sql like every other app_* function.
create or replace function public.app_engagement_payments_settled(
  p_engagement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.engagement_milestones m
    join public.design_engagements de on de.id = m.engagement_id
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
    where m.engagement_id = p_engagement_id
      and (due.amount - coalesce(cl.cleared, 0)) > 0
  );
$$;

-- BOQ as a proposal: may the client open this engagement's BOQ? STRICTER than
-- `app_engagement_payments_settled`, on purpose: the engagement must HAVE a fee
-- schedule (at least one milestone) AND it must be settled.
--
-- Why not the free-gate rule above: every BOQ issue publishes its artifact,
-- including a BOQ issued while the engagement is still at `created` with no fee
-- schedule yet. Under "no milestones = settled" that BOQ, the document the studio
-- is paid for, would be downloadable the moment it is issued. Nothing has been
-- agreed, so nothing has been paid for, so it is withheld.
--
-- `app_engagement_payments_settled` itself is unchanged: its free-gate rule still
-- governs every other gated deliverable and the money guards.
--
-- SECURITY DEFINER + empty search_path, takes a bare engagement id, and is
-- REVOKED from public in roles.sql, for the same reason as the function above.
-- Defined AFTER it: a `language sql` body is validated at CREATE time.
create or replace function public.app_boq_releasable(
  p_engagement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.engagement_milestones m
    where m.engagement_id = p_engagement_id
  )
  and public.app_engagement_payments_settled(p_engagement_id);
$$;

-- Is the payment condition for releasing ONE document of this kind met? A `boq`
-- reads its own rule above; every other kind reads the settled test. The single
-- place the portal list and the download resolver turn (kind, engagement) into
-- the `p_settled` argument of `app_document_access`, so the two can never
-- disagree. Same lockdown as the two functions it calls (roles.sql).
create or replace function public.app_document_settled(
  p_kind public.engagement_artifact_kind,
  p_engagement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_kind = 'boq' then public.app_boq_releasable(p_engagement_id)
    else public.app_engagement_payments_settled(p_engagement_id)
  end;
$$;

-- Client Deliverables Step 3 — what a client may do with ONE released document,
-- given whether the engagement's payments are settled. The single declaration of
-- the rule; both the portal list and the download route read it, so the button the
-- client sees and the bytes the route serves can never disagree.
--
--   'withheld' — the BOQ before the money is in. It carries the firm's own rates
--                and the execution cost; it is the thing the studio is paid for, so
--                it is not listed as retrievable at all until settled. For a
--                `boq`, "settled" also requires a fee schedule to exist: the
--                callers pass `app_document_settled`, not the bare settled test.
--   'preview'  — the approved 3D render before the money is in. The client SEES the
--                design (a downscaled, non-deliverable rendition) but cannot pull
--                the full-resolution file.
--   'download' — everything else, and everything once settled.
--
-- PREVIEW REQUIRES A TRANSFORMABLE IMAGE. Storage resizes images only; it serves a
-- PDF back untouched. A render stored as PDF therefore CANNOT be shown as a
-- downscaled rendition, so it is WITHHELD rather than handed over in full — fail
-- closed, because the alternative is shipping the deliverable to an unpaid client.
-- (Practical consequence for studios: upload 3D visuals as PNG/JPG if you want the
-- client to be able to look before paying.)
create or replace function public.app_document_access(
  p_kind public.engagement_artifact_kind,
  p_settled boolean,
  p_original_name text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_settled then 'download'
    when p_kind = 'boq' then 'withheld'
    when p_kind = 'approved_render' then
      case
        when lower(coalesce(
          substring(p_original_name from '\.([A-Za-z0-9]{1,5})$'), ''
        )) in ('png', 'jpg', 'jpeg') then 'preview'
        else 'withheld'
      end
    else 'download'
  end;
$$;

-- Round C (0058): THE rule for "is this file an image, a PDF or something
-- else", by the extension of its stored name: png, jpg, jpeg, webp = 'image';
-- pdf = 'pdf'; anything else, no extension or a NULL name = 'other'. The portal
-- snapshot (documents[].media), the download route's resolver
-- (app_delivery_document_by_token) and the studio logo (app_delivery_logo_by_token)
-- all read it, so the thumbnail the portal shows and the bytes the route serves
-- can never disagree about what a file is.
--
-- It is not app_document_access's preview test: a payment-gated PREVIEW still
-- needs a png/jpg/jpeg (webp is an image here, but is withheld before payment
-- there). IMMUTABLE and not SECURITY DEFINER: it reads no table. Revoked from
-- public and the API roles right below, like every app_* function.
create or replace function public.app_document_media(p_original_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(
    substring(p_original_name from '\.([A-Za-z0-9]{1,5})$'), ''
  ))
    when 'png' then 'image'
    when 'jpg' then 'image'
    when 'jpeg' then 'image'
    when 'webp' then 'image'
    when 'pdf' then 'pdf'
    else 'other'
  end;
$$;

-- Closed in the SAME implicit transaction as the CREATE above (see
-- app_concept_option_positions below for why). The metra_app grant is guarded
-- because on a fresh database roles.sql, which creates that role, has not run.
revoke all on function public.app_document_media(text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_document_media(text) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_document_media(text) to metra_app;
  end if;
end
$$;

-- Round B (0057): THE rule that letters concept options, the released
-- (`client_visible`), file-bearing `concept_option` artifacts of one delivery,
-- ranked by (attested_at, id), positions 1 to 4 (option A to D). A fifth
-- visible option, a hidden one and one without a file get no position.
-- Positions rank only what the client can see NOW, so hiding or releasing an
-- option renumbers the later ones; a CHOICE therefore saves the position it
-- was made under (engagement_events.chosen_position) and is never re-ranked.
--
-- ONE function, three callers: app_delivery_by_token (the letters the portal
-- shows), app_delivery_choose_concept_by_token (the letter it accepts) and the
-- studio's artifact query (lib/engagements/queries/concept-positions.ts), so
-- the studio and the client can never letter the same option differently.
-- Callers must never re-rank in JS: attested_at has microseconds and a JS Date
-- keeps milliseconds.
--
-- SECURITY INVOKER on purpose. Called from the two definer functions it runs
-- with their rights and sees the delivery they proved; called by metra_app
-- from the studio it is org-scoped by RLS (design_engagements, artifacts and
-- files all are), so a foreign engagement id returns nothing. It returns ids
-- and numbers only, never a label, a file name or a money column.
--
-- THE JOIN TO design_engagements is for the plan as much as for scoping: every
-- engagement_artifacts index leads with org_id, so `a.org_id = de.org_id` lets
-- the definer callers (which bypass RLS and so carry no org qual) range-scan
-- ONE delivery's artifacts instead of walking the whole index across tenants.
create or replace function public.app_concept_option_positions(p_engagement_id uuid)
returns table (artifact_id uuid, option_position integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select ranked.id, ranked.rn
  from (
    select a.id, (row_number() over (order by a.attested_at, a.id))::integer as rn
    from public.design_engagements de
    join public.engagement_artifacts a
      on a.org_id = de.org_id and a.engagement_id = de.id
    join public.files f on f.id = a.file_id and f.org_id = a.org_id
    where de.id = p_engagement_id
      and a.kind = 'concept_option'
      and a.client_visible
  ) ranked
  where ranked.rn <= 4
  order by ranked.rn;
$$;

-- Closed in the SAME implicit transaction as the CREATE above. A new function
-- is executable by PUBLIC (and, on Supabase, by the API roles through default
-- privileges) from the moment it exists; roles.sql revokes that too, but it
-- runs later, in its own transaction. This leaves no window. The metra_app
-- grant is guarded because on a fresh database roles.sql, which creates that
-- role, has not run yet.
revoke all on function public.app_concept_option_positions(uuid) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function public.app_concept_option_positions(uuid) from %I',
        r
      );
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'metra_app') then
    grant execute on function public.app_concept_option_positions(uuid) to metra_app;
  end if;
end
$$;

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
--     rom_low, rom_high (the budget band, and ONLY once rom_issued_at is
--     stamped — an unissued band is the studio's private working state),
--     share_expires_at
--   organizations (the firm): name_ar, name_en, logo_file_id;
--     studio_phone, studio_whatsapp (Round C, 0058: firm.phone, firm.whatsapp,
--     the Call and WhatsApp buttons, shown whenever set);
--     instapay_address, bank_name, bank_account_holder, bank_account_number,
--     bank_iban (0058: `payment_details`, the studio's own payment
--     instructions, written by owner/admin for clients to read). ONLY while a
--     payment is due: null on an ended delivery, null once every milestone is
--     settled (or there is no schedule), and null unless an InstaPay address,
--     an account number or an IBAN is set. The TS mapper
--     (lib/engagements/public) applies the same rule before the browser.
--   clients (the end client): name_ar, name_en
--   engagement_milestones: kind, basis, sort_order, value (only as an input to
--     the client's amount_due — the raw basis value is not leaked as cost)
--   payment_events: amount (aggregated per kind into amount_cleared)
--   engagement_artifacts (Client Deliverables Step 1, only where client_visible):
--     id, kind, updated_at (as shared_at). `label`, `note`, `content_hash`,
--     `attested_by` and files.original_name/size_bytes are NOT exposed — an
--     internal label or filename can itself be sensitive. `files` is joined only to
--     prove a downloadable object exists; no column of it is returned.
--   concept_options (Round B, 0056; letters 0057): id and a 1-based
--     `position` (1..4 = option A..D) for each released, file-bearing
--     `concept_option` of this delivery, from app_concept_option_positions,
--     the one rule the choose function and the studio also read. Positions
--     rank VISIBLE options only, so hiding or releasing one renumbers the
--     later ones. Consumers must use THIS position and never re-rank in JS:
--     attested_at has microseconds and a JS Date keeps milliseconds.
--   concept_choice_id + concept_choice_position (Round B, 0056; 0057): the
--     option named by the newest LIVE (not retracted) CLIENT concept_approval
--     and the letter SAVED on that row (engagement_events.chosen_position),
--     the one the client saw when choosing. Both null when there is none or it
--     named no option. A choice keeps its saved letter whatever the studio
--     hides or releases afterwards; it is never re-ranked.
--   concept_decision (0057, B12): which concept decision of the client is on
--     file, from the newest LIVE client concept_approval or
--     concept_change_request: 'chosen' (an approval naming an option),
--     'approved' (a plain approval), 'changes_requested', or null. A repeat
--     tap that the write answers `already` is told what was actually SAVED,
--     never the option it just named.
--   claim.claimable_milestones (0058): empty on an ended delivery
--     (abandoned, closed_design_only, execution), where the claim write
--     answers not_active.
--   claim.claimable_milestones[].claimed_at (0058): created_at of that
--     milestone's PENDING client claim (null when there is none), so the page
--     can say when the client marked it as paid. No other claim column.
--   documents[].media (0058): 'image' | 'pdf' | 'other' from
--     app_document_media(files.original_name). The name itself is still never
--     returned; only this three-way class of it is.
--   expected_on (0058): design_engagements.client_expected_on, ONLY while
--     client_expected_state equals the current state, no state move is in
--     engagement_transitions after client_expected_set_at, and the date is
--     today or later in Africa/Cairo; so a stage move retires the date for good
--     without any write. client_expected_state and client_expected_set_at are
--     read, never returned.
--   design_decision (0058): the newest LIVE client design_approval or
--     design_change_request of the CURRENT render round (the respond
--     function's round predicate on renders_ready_at) as
--     { kind: 'approved' | 'changes_requested', at: decided_at }, else null.
--   handover_acknowledged_at (0058): decided_at of the newest LIVE
--     handoff_acknowledgement, the client's own or one the studio recorded
--     for them, else null.
--   rom_acknowledged_at (0058): decided_at of the newest LIVE client
--     rom_acknowledgement of the CURRENT issuance (acknowledged_issue_at is not
--     distinct from rom_issued_at), only while a band is issued; else null.
--   timeline (0058): the newest 60 of, newest first (at the same instant: a
--     stage before a decision before a payment, payments by amount, then id):
--     * { type: 'stage', state, at } per engagement_transitions row of this
--       delivery that MOVED the state (to_state not null and distinct from
--       from_state; self-loops are not stages). `state` is the raw key the TS
--       layer maps to a client word, as for the top-level `state`;
--     * { type: 'decision', kind, at, by_studio, option_position } per LIVE
--       engagement_events row of the six decision kinds that is the client's
--       own (actor_channel = 'client'), or a budget or handover
--       acknowledgement, or a concept/design approval the studio recorded WITH
--       evidence (by_studio = true). option_position is the saved letter of a
--       concept choice, else null;
--     * { type: 'payment', kind, amount, at } per payment_events row (amount
--       as a scale-4 string, at = cleared_at): money the CLIENT paid.
--     Never selected for the timeline: an actor id or name, a note, evidence
--     text, a payment method or reference, the trigger name.
--
-- RETRACTED CLIENT DECISIONS (an event_correction points at them) answer
--   nothing here, exactly as liveEvents() drops them in the studio's TS rule.
--   A retracted row still holds the 0049 unique slot of its kind, so the ONE
--   verb whose insert would collide with it is not offered (the write would
--   answer `already`); the other verb of the pair stays open.
--
-- READ, NEVER RETURNED: design_engagements.renders_ready_at (Round B). The
--   design decision verbs in `client_actions` answer ONE render issuance, so
--   the predicate compares the client's design decisions against it; the value
--   itself does not cross the wire. Likewise client_expected_state (0058).
--
-- PHYSICALLY OMITTED (never referenced): design_engagements.render_manifest_hash,
--   revision_count, free_revision_n, design_revision_count,
--   free_design_revision_n, as_built_due,
--   concept_locked_at, token_hash, token_nonce, updated_at, org_id, client_id,
--   project_id;
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
    -- ONLY an ISSUED band reaches the client. rom_low/rom_high are the studio's
    -- private working numbers until issueRomCore stamps rom_issued_at, and any
    -- edit clears that stamp, so a revised band goes quiet again until it is
    -- deliberately re-issued.
    'rom', case
      when de.rom_issued_at is null then null
      when de.rom_low is null and de.rom_high is null then null
      else jsonb_build_object('low', de.rom_low::text, 'high', de.rom_high::text)
    end,
    'share_expires_at', de.share_expires_at,
    'firm', jsonb_build_object(
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'logo_file_id', o.logo_file_id,
      'phone', o.studio_phone,
      'whatsapp', o.studio_whatsapp
    ),
    -- Round C (0058): the studio's payment instructions, ONLY while a payment
    -- is due (owner decision): null on a delivery that has ended (abandoned,
    -- closed_design_only, execution: the claim write answers not_active there,
    -- and `claim` below lists nothing), null when no milestone has a remaining
    -- due (the settled test, the same price-blind math as `claim`, so a
    -- schedule with no milestones is settled too), and null unless the studio
    -- set a USABLE method: an InstaPay address, or an account number or IBAN
    -- (each of which needs a bank name, by CHECK). The TS mapper applies the
    -- same rule again before the browser.
    'payment_details', case
      when de.state in ('closed_design_only', 'execution', 'abandoned') then null
      when public.app_engagement_payments_settled(de.id) then null
      when o.instapay_address is null and o.bank_account_number is null
           and o.bank_iban is null then null
      else jsonb_build_object(
        'instapay', o.instapay_address,
        'bank_name', o.bank_name,
        'bank_account_holder', o.bank_account_holder,
        'bank_account_number', o.bank_account_number,
        'bank_iban', o.bank_iban
      )
    end,
    -- Round C (0058): the date the client should expect the next step. Shown
    -- only while (1) the delivery is still in the stage the studio set it in,
    -- (2) no state move has been recorded since it was set (a revision loop
    -- that comes back into the same stage does not bring an old date back),
    -- and (3) the date is today or later in Cairo (a passed date is not an
    -- expectation). Otherwise null; nothing is written to retire it.
    'expected_on', case
      when de.client_expected_state = de.state
       and de.client_expected_on >= (now() at time zone 'Africa/Cairo')::date
       and not exists (
         select 1 from public.engagement_transitions tr
         where tr.engagement_id = de.id
           and tr.org_id = de.org_id
           and tr.to_state is not null
           and tr.to_state is distinct from tr.from_state
           and tr.decided_at > de.client_expected_set_at
       )
      then de.client_expected_on
    end,
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
        -- Round B: a verb is offered while (1) no LIVE client decision of its
        -- pair answers the current round, and (2) no client row of the verb's
        -- OWN kind holds the unique slot its insert would take. (1) ignores a
        -- decision the studio retracted (an event_correction points at it),
        -- as liveEvents() does in TS; (2) counts it, because it still holds
        -- the 0049 index slot and the write would answer `already`. Exactly
        -- the outcome app_delivery_respond_by_token produces.
        select 'approve_concept' as action, 1 as ord
        where de.state = 'concept_review'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('concept_approval', 'concept_change_request')
              and (
                (e.kind = 'concept_approval' and e.acknowledged_issue_at is null)
                or not exists (
                  select 1 from public.engagement_events x
                  where x.org_id = e.org_id and x.supersedes_event_id = e.id
                )
              )
          )
        union all
        select 'request_concept_changes', 2
        where de.state = 'concept_review'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('concept_approval', 'concept_change_request')
              and (
                (e.kind = 'concept_change_request' and e.acknowledged_issue_at is null)
                or not exists (
                  select 1 from public.engagement_events x
                  where x.org_id = e.org_id and x.supersedes_event_id = e.id
                )
              )
          )
        union all
        -- Round B: a design decision answers ONE render issuance. Only a live
        -- decision stamped with the current renders_ready_at, or a live legacy
        -- unstamped one made at or after it, closes the pair, so a revision
        -- re-offers it. With no issuance at all, both sides are NULL and the
        -- first branch keeps the old one-per-delivery rule. The same predicate
        -- as app_delivery_respond_by_token's pre-check. The slot of a design
        -- verb is its kind stamped with the current renders_ready_at.
        select 'approve_design', 3
        where de.state = 'final_approval'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('design_approval', 'design_change_request')
              and (
                (e.kind = 'design_approval'
                 and e.acknowledged_issue_at is not distinct from de.renders_ready_at)
                or (
                  not exists (
                    select 1 from public.engagement_events x
                    where x.org_id = e.org_id and x.supersedes_event_id = e.id
                  )
                  and (
                    e.acknowledged_issue_at is not distinct from de.renders_ready_at
                    or (e.acknowledged_issue_at is null
                        and de.renders_ready_at is not null
                        and e.decided_at >= de.renders_ready_at)
                  )
                )
              )
          )
        union all
        select 'request_design_changes', 4
        where de.state = 'final_approval'
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind in ('design_approval', 'design_change_request')
              and (
                (e.kind = 'design_change_request'
                 and e.acknowledged_issue_at is not distinct from de.renders_ready_at)
                or (
                  not exists (
                    select 1 from public.engagement_events x
                    where x.org_id = e.org_id and x.supersedes_event_id = e.id
                  )
                  and (
                    e.acknowledged_issue_at is not distinct from de.renders_ready_at
                    or (e.acknowledged_issue_at is null
                        and de.renders_ready_at is not null
                        and e.decided_at >= de.renders_ready_at)
                  )
                )
              )
          )
        union all
        select 'acknowledge_rom', 5
        where de.rom_low is not null
          and de.rom_high is not null
          -- Never offer the verb for a band the client cannot even see.
          and de.rom_issued_at is not null
          and de.state not in ('closed_design_only', 'execution', 'abandoned')
          -- 0049: an acknowledgement answers ONE issuance. Re-issuing a revised
          -- band re-offers the verb, because the client has not seen these
          -- numbers. `is not distinct from` so a legacy NULL acknowledgement
          -- (recorded before 0049, issuance unknown) does NOT match a real
          -- issuance instant and therefore does not suppress the verb.
          and not exists (
            select 1 from public.engagement_events e
            where e.engagement_id = de.id
              and e.actor_channel = 'client'
              and e.kind = 'rom_acknowledgement'
              and e.acknowledged_issue_at is not distinct from de.rom_issued_at
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
              ),
              -- Round C (0058): when the client marked it as paid. At most one
              -- pending claim per milestone (0034), so max() is that one.
              'claimed_at', (
                select max(pc.created_at) from public.client_payment_claims pc
                where pc.engagement_id = de.id
                  and pc.org_id = de.org_id
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
            -- Round C (0058): nothing is claimable on a delivery that has
            -- ended; app_delivery_claim_payment_by_token answers not_active
            -- there, so offering the claim would only end in a refusal.
            and de.state not in ('closed_design_only', 'execution', 'abandoned')
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
            ),
            -- Step 3 — what the client may DO with this file right now. Computed
            -- here (not in TS) so the portal's button and the download route's
            -- enforcement read ONE rule.
            'access', public.app_document_access(
              a.kind, public.app_document_settled(a.kind, de.id), f.original_name
            ),
            -- Round C (0058): image, pdf or other, by the one media rule the
            -- download route also reads. The file name is not returned.
            'media', public.app_document_media(f.original_name)
          ) as d
        from public.engagement_artifacts a
        join public.files f on f.id = a.file_id and f.org_id = a.org_id
        where a.engagement_id = de.id and a.org_id = de.org_id and a.client_visible
        order by a.attested_at desc
        limit 200
      ) dx
    ), '[]'::jsonb),
    -- Round B: the concept options the client may CHOOSE between, lettered
    -- by app_concept_option_positions (released, file-bearing, A to D in the
    -- order the client sees them). Only the id and the number cross the wire;
    -- the label and the file name stay internal, as for `documents`.
    'concept_options', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', p.artifact_id, 'position', p.option_position)
        order by p.option_position
      )
      from public.app_concept_option_positions(de.id) p
    ), '[]'::jsonb),
    -- Round B: which option the client chose, and the letter SAVED with that
    -- choice (0057): from the newest LIVE client concept approval (one the
    -- studio retracted with an event_correction answers nothing). Both null
    -- when there is none or it named no option. The saved letter survives the
    -- studio hiding or releasing options.
    'concept_choice_id', choice.chosen_artifact_id,
    'concept_choice_position', choice.chosen_position,
    -- Round B (B12): the client's concept decision on file, of either kind.
    'concept_decision', (
      select case
        when e.kind = 'concept_change_request' then 'changes_requested'
        when e.chosen_artifact_id is not null then 'chosen'
        else 'approved'
      end
      from public.engagement_events e
      where e.engagement_id = de.id
        and e.actor_channel = 'client'
        and e.kind in ('concept_approval', 'concept_change_request')
        and not exists (
          select 1 from public.engagement_events x
          where x.org_id = e.org_id and x.supersedes_event_id = e.id
        )
      order by e.decided_at desc
      limit 1
    ),
    -- Round C (0058): the client's design decision on file for the CURRENT
    -- render round, by the respond function's own round predicate, so a
    -- re-issued set of renders reads as "no decision yet".
    'design_decision', (
      select jsonb_build_object(
        'kind', case when e.kind = 'design_approval' then 'approved' else 'changes_requested' end,
        'at', e.decided_at
      )
      from public.engagement_events e
      where e.engagement_id = de.id
        and e.org_id = de.org_id
        and e.actor_channel = 'client'
        and e.kind in ('design_approval', 'design_change_request')
        and not exists (
          select 1 from public.engagement_events x
          where x.org_id = e.org_id and x.supersedes_event_id = e.id
        )
        and (
          e.acknowledged_issue_at is not distinct from de.renders_ready_at
          or (e.acknowledged_issue_at is null
              and de.renders_ready_at is not null
              and e.decided_at >= de.renders_ready_at)
        )
      order by e.decided_at desc
      limit 1
    ),
    -- Round C (0058): when the handover was confirmed: the newest LIVE
    -- handoff_acknowledgement, whether the client tapped it or the studio
    -- recorded it for them (the timeline shows both), so the page never says
    -- the package was received in one place and not in another.
    -- app_delivery_close_target_by_token stays client-only on purpose.
    'handover_acknowledged_at', (
      select max(e.decided_at)
      from public.engagement_events e
      where e.engagement_id = de.id
        and e.org_id = de.org_id
        and e.kind = 'handoff_acknowledgement'
        and not exists (
          select 1 from public.engagement_events x
          where x.org_id = e.org_id and x.supersedes_event_id = e.id
        )
    ),
    -- Round C (0058): when the client acknowledged the band issued NOW. A
    -- re-issued band reads as not yet acknowledged.
    'rom_acknowledged_at', case
      when de.rom_issued_at is null then null
      else (
        select max(e.decided_at)
        from public.engagement_events e
        where e.engagement_id = de.id
          and e.org_id = de.org_id
          and e.actor_channel = 'client'
          and e.kind = 'rom_acknowledgement'
          and e.acknowledged_issue_at is not distinct from de.rom_issued_at
          and not exists (
            select 1 from public.engagement_events x
            where x.org_id = e.org_id and x.supersedes_event_id = e.id
          )
      )
    end,
    -- Round C (0058): what happened, dated, newest first, at most 60 entries.
    -- Only the fields listed in the header comment are selected: no actor,
    -- note, evidence text, method or reference. Same-instant entries are
    -- ordered causally and without any collation: a stage move reads as newer
    -- than the decision or payment that caused it (rank 0 before 1 and 2),
    -- payments by amount as numbers, and the row id last.
    'timeline', coalesce((
      select jsonb_agg(
        t.entry order by t.at desc, t.causal_rank, t.amount desc nulls last, t.id desc
      )
      from (
        select u.entry, u.at, u.causal_rank, u.amount, u.id
        from (
          select jsonb_build_object(
                   'type', 'stage',
                   'state', tr.to_state,
                   'at', tr.decided_at
                 ) as entry,
                 tr.decided_at as at,
                 0 as causal_rank,
                 null::numeric as amount,
                 tr.id
          from public.engagement_transitions tr
          where tr.engagement_id = de.id
            and tr.org_id = de.org_id
            and tr.to_state is not null
            and tr.to_state is distinct from tr.from_state
          union all
          select jsonb_build_object(
                   'type', 'decision',
                   'kind', e.kind,
                   'at', e.decided_at,
                   'by_studio', e.actor_channel <> 'client',
                   'option_position', e.chosen_position
                 ),
                 e.decided_at,
                 1,
                 null::numeric,
                 e.id
          from public.engagement_events e
          where e.engagement_id = de.id
            and e.org_id = de.org_id
            and e.kind in ('concept_approval', 'concept_change_request',
                           'design_approval', 'design_change_request',
                           'rom_acknowledgement', 'handoff_acknowledgement')
            and (
              e.actor_channel = 'client'
              or e.kind in ('rom_acknowledgement', 'handoff_acknowledgement')
              or (e.kind in ('concept_approval', 'design_approval')
                  and e.evidence is not null)
            )
            and not exists (
              select 1 from public.engagement_events x
              where x.org_id = e.org_id and x.supersedes_event_id = e.id
            )
          union all
          select jsonb_build_object(
                   'type', 'payment',
                   'kind', pe.kind,
                   'amount', pe.amount::numeric(18, 4)::text,
                   'at', pe.cleared_at
                 ),
                 pe.cleared_at,
                 2,
                 pe.amount,
                 pe.id
          from public.payment_events pe
          where pe.engagement_id = de.id
            and pe.org_id = de.org_id
        ) u
        order by u.at desc, u.causal_rank, u.amount desc nulls last, u.id desc
        limit 60
      ) t
    ), '[]'::jsonb)
  )
  from public.design_engagements de
  join public.organizations o on o.id = de.org_id
  join public.clients c on c.id = de.client_id
  left join lateral (
    select e.chosen_artifact_id, e.chosen_position
    from public.engagement_events e
    where e.engagement_id = de.id
      and e.actor_channel = 'client'
      and e.kind = 'concept_approval'
      and not exists (
        select 1 from public.engagement_events x
        where x.org_id = e.org_id and x.supersedes_event_id = e.id
      )
    order by e.decided_at desc
    limit 1
  ) choice on true
  where de.token_hash = p_hash
    and (de.share_expires_at is null or de.share_expires_at > now());
$$;
