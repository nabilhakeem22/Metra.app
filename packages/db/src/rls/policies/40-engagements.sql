-- rls/policies/40-engagements.sql — the design-engagement machine.
--
-- One of the policies/* files apply-rls runs LAST, in the order
-- rls/manifest.ts declares. Every statement here is idempotent
-- (`drop ... if exists` / `create or replace` / `alter table ... enable`).
-- A table's triggers live in the SAME file as its policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- Design Engagements (Design-Engagement Machine, Step 1) — org isolation for the
-- engagement record + its append-only transition ledger.
-- =============================================================================

-- design_engagements
alter table public.design_engagements enable row level security;
alter table public.design_engagements force  row level security;
drop policy if exists org_isolation on public.design_engagements;
create policy org_isolation on public.design_engagements
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_transitions (append-only via grants; org-isolated + membership-gated)
alter table public.engagement_transitions enable row level security;
alter table public.engagement_transitions force  row level security;
drop policy if exists org_isolation on public.engagement_transitions;
create policy org_isolation on public.engagement_transitions
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_milestones (Step 3; full DML — the fee schedule is editable while
-- the engagement is being set up; org-isolated + membership-gated)
alter table public.engagement_milestones enable row level security;
alter table public.engagement_milestones force  row level security;
drop policy if exists org_isolation on public.engagement_milestones;
create policy org_isolation on public.engagement_milestones
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- payment_events (Step 4; append-only via grants — SELECT + INSERT only, no
-- UPDATE/DELETE; org-isolated + membership-gated, like contract_events)
alter table public.payment_events enable row level security;
alter table public.payment_events force  row level security;
drop policy if exists org_isolation on public.payment_events;
create policy org_isolation on public.payment_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_artifacts (Step 5; full-ish DML — artifacts are re-attestable /
-- relabellable, so SELECT + INSERT + UPDATE grants — no DELETE; org-isolated +
-- membership-gated)
alter table public.engagement_artifacts enable row level security;
alter table public.engagement_artifacts force  row level security;
drop policy if exists org_isolation on public.engagement_artifacts;
create policy org_isolation on public.engagement_artifacts
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_events (Step 7; append-only via grants — SELECT + INSERT only, no
-- UPDATE/DELETE; org-isolated + membership-gated, like contract_events)
alter table public.engagement_events enable row level security;
alter table public.engagement_events force  row level security;
drop policy if exists org_isolation on public.engagement_events;
create policy org_isolation on public.engagement_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_change_orders (Step 8; SELECT + INSERT + UPDATE grants — UPDATE is
-- reserved for the Step-9 settle path; no DELETE; org-isolated + membership-gated)
alter table public.engagement_change_orders enable row level security;
alter table public.engagement_change_orders force  row level security;
drop policy if exists org_isolation on public.engagement_change_orders;
create policy org_isolation on public.engagement_change_orders
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- client_payment_claims (Client Delivery Portal Phase 3; MUTABLE lifecycle —
-- SELECT + INSERT + UPDATE grants, the studio confirm/dismiss updates status; no
-- DELETE; org-isolated + membership-gated). The client "mark as paid" INSERT is
-- done by the SECURITY DEFINER token SDF (bypasses RLS as owner); this policy
-- governs the authenticated studio's cockpit reads + confirm/dismiss updates.
alter table public.client_payment_claims enable row level security;
alter table public.client_payment_claims force  row level security;
drop policy if exists org_isolation on public.client_payment_claims;
create policy org_isolation on public.client_payment_claims
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- document_categories (clients + projects spec): the firm's own filing vocabulary.
-- SELECT + INSERT + UPDATE (rename / reorder / deactivate); NO DELETE — a category
-- files already sit under is retired with `active = false`, never removed.
alter table public.document_categories enable row level security;
alter table public.document_categories force  row level security;
drop policy if exists org_isolation on public.document_categories;
create policy org_isolation on public.document_categories
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- engagement_document_comments (Client Deliverables Step 2; APPEND-ONLY — SELECT +
-- INSERT grants only, no UPDATE/DELETE, so a message can never be edited or removed
-- by either side; org-isolated + membership-gated). The session-less client's
-- message INSERT is done by the SECURITY DEFINER token SDF (bypasses RLS as owner);
-- this policy governs the authenticated studio reading a thread and replying to it.
alter table public.engagement_document_comments enable row level security;
alter table public.engagement_document_comments force  row level security;
drop policy if exists org_isolation on public.engagement_document_comments;
create policy org_isolation on public.engagement_document_comments
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );
