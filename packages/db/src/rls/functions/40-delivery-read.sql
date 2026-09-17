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

-- Client Deliverables Step 3 — what a client may do with ONE released document,
-- given whether the engagement's payments are settled. The single declaration of
-- the rule; both the portal list and the download route read it, so the button the
-- client sees and the bytes the route serves can never disagree.
--
--   'withheld' — the BOQ before the money is in. It carries the firm's own rates
--                and the execution cost; it is the thing the studio is paid for, so
--                it is not listed as retrievable at all until settled.
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
            ),
            -- Step 3 — what the client may DO with this file right now. Computed
            -- here (not in TS) so the portal's button and the download route's
            -- enforcement read ONE rule.
            'access', public.app_document_access(
              a.kind, public.app_engagement_payments_settled(de.id), f.original_name
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
