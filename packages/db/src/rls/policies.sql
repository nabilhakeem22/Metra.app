-- Row-Level Security: enable + FORCE on every business table, keyed to the
-- request-scoped GUCs. Defense-in-depth membership second factor:
--
--   ORG  = nullif(current_setting('app.current_org_id',  true), '')::uuid
--   USER = nullif(current_setting('app.current_user_id', true), '')::uuid
--
-- Beyond org isolation, every read/write ALSO requires the session user be a
-- member of the current org: public.app_is_current_org_member(). A forged
-- context (org A + a userId that is not a member of A) therefore sees 0 rows and
-- cannot write — even though app.current_org_id says "A".
--
-- CRITICAL: `user_id = USER` appears ONLY in memberships' WITH CHECK (the
-- bootstrap carve-out). It NEVER appears in any USING clause — a permissive
-- `org_id = ORG OR user_id = USER` USING would reopen the old multi-org read
-- leak. Bootstrap writes (createOrg founding owner; acceptInvite membership for a
-- not-yet-member) are allowed only via app_can_bootstrap_membership(), which is
-- scoped to the caller's own user/email and cannot become a self-join backdoor.
--
-- nullif(..., '') makes an unset/reset GUC NULL -> predicate false -> 0 rows
-- (fails closed). Idempotent.

-- organizations: no org_id column; the tenant boundary is its own id. WITH CHECK
-- stays bootstrap-open (id = ORG only) so createOrg's founding org insert works
-- before any membership exists.
alter table public.organizations enable row level security;
alter table public.organizations force  row level security;
drop policy if exists org_isolation on public.organizations;
create policy org_isolation on public.organizations
  using (
    id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    id = nullif(current_setting('app.current_org_id', true), '')::uuid
  );

-- memberships: read/most-writes require membership; WITH CHECK additionally
-- permits inserting the caller's OWN row during a legitimate bootstrap.
alter table public.memberships enable row level security;
alter table public.memberships force  row level security;
drop policy if exists org_isolation on public.memberships;
drop policy if exists self_memberships on public.memberships;
create policy org_isolation on public.memberships
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and (
      public.app_is_current_org_member()
      or (
        user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
        and public.app_can_bootstrap_membership()
      )
    )
  );

-- files
alter table public.files enable row level security;
alter table public.files force  row level security;
drop policy if exists org_isolation on public.files;
create policy org_isolation on public.files
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- audit_log (append-only via grants; still org-isolated + membership-gated)
alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;
drop policy if exists org_isolation on public.audit_log;
create policy org_isolation on public.audit_log
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- invitations
alter table public.invitations enable row level security;
alter table public.invitations force  row level security;
drop policy if exists org_isolation on public.invitations;
create policy org_isolation on public.invitations
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- sections (per-tenant work sections; shared by Price Book + proposal builder)
alter table public.sections enable row level security;
alter table public.sections force  row level security;
drop policy if exists org_isolation on public.sections;
create policy org_isolation on public.sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- cost_items (P1 Price Book)
alter table public.cost_items enable row level security;
alter table public.cost_items force  row level security;
drop policy if exists org_isolation on public.cost_items;
create policy org_isolation on public.cost_items
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- price_changes (append-only via grants; still org-isolated + membership-gated)
alter table public.price_changes enable row level security;
alter table public.price_changes force  row level security;
drop policy if exists org_isolation on public.price_changes;
create policy org_isolation on public.price_changes
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- price_change_lines (append-only via grants; org-isolated + membership-gated)
alter table public.price_change_lines enable row level security;
alter table public.price_change_lines force  row level security;
drop policy if exists org_isolation on public.price_change_lines;
create policy org_isolation on public.price_change_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- clients (P1 Slice 2)
alter table public.clients enable row level security;
alter table public.clients force  row level security;
drop policy if exists org_isolation on public.clients;
create policy org_isolation on public.clients
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- client_contacts (P1 Slice 4)
alter table public.client_contacts enable row level security;
alter table public.client_contacts force  row level security;
drop policy if exists org_isolation on public.client_contacts;
create policy org_isolation on public.client_contacts
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- activities (P1 Slice 4; polymorphic feed)
alter table public.activities enable row level security;
alter table public.activities force  row level security;
drop policy if exists org_isolation on public.activities;
create policy org_isolation on public.activities
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- projects (P1 Slice 2)
alter table public.projects enable row level security;
alter table public.projects force  row level security;
drop policy if exists org_isolation on public.projects;
create policy org_isolation on public.projects
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- project_types (P1 Slice 5; editable classifications)
alter table public.project_types enable row level security;
alter table public.project_types force  row level security;
drop policy if exists org_isolation on public.project_types;
create policy org_isolation on public.project_types
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- stage_templates (P1 Slice 5; org-wide stage process)
alter table public.stage_templates enable row level security;
alter table public.stage_templates force  row level security;
drop policy if exists org_isolation on public.stage_templates;
create policy org_isolation on public.stage_templates
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- project_stages (P1 Slice 5; per-project stages)
alter table public.project_stages enable row level security;
alter table public.project_stages force  row level security;
drop policy if exists org_isolation on public.project_stages;
create policy org_isolation on public.project_stages
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- =============================================================================
-- P1 Slice 3 — Proposals (org isolation for all 4 tables; append-only events;
-- status-immutable proposals; child-draft guard on sections + lines)
-- =============================================================================

-- proposals
alter table public.proposals enable row level security;
alter table public.proposals force  row level security;
drop policy if exists org_isolation on public.proposals;
create policy org_isolation on public.proposals
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- proposal_sections
alter table public.proposal_sections enable row level security;
alter table public.proposal_sections force  row level security;
drop policy if exists org_isolation on public.proposal_sections;
create policy org_isolation on public.proposal_sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- proposal_lines
alter table public.proposal_lines enable row level security;
alter table public.proposal_lines force  row level security;
drop policy if exists org_isolation on public.proposal_lines;
create policy org_isolation on public.proposal_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- proposal_events (append-only via grants; org-isolated + membership-gated)
alter table public.proposal_events enable row level security;
alter table public.proposal_events force  row level security;
drop policy if exists org_isolation on public.proposal_events;
create policy org_isolation on public.proposal_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- =============================================================================
-- P1 Slice 4 — Contracts + Variation Orders (org isolation for all 7 tables;
-- append-only event tables; status-immutable contracts + VOs; child-draft guards)
-- =============================================================================

-- contracts
alter table public.contracts enable row level security;
alter table public.contracts force  row level security;
drop policy if exists org_isolation on public.contracts;
create policy org_isolation on public.contracts
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_sections
alter table public.contract_sections enable row level security;
alter table public.contract_sections force  row level security;
drop policy if exists org_isolation on public.contract_sections;
create policy org_isolation on public.contract_sections
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_lines
alter table public.contract_lines enable row level security;
alter table public.contract_lines force  row level security;
drop policy if exists org_isolation on public.contract_lines;
create policy org_isolation on public.contract_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- contract_events (append-only via grants; org-isolated + membership-gated)
alter table public.contract_events enable row level security;
alter table public.contract_events force  row level security;
drop policy if exists org_isolation on public.contract_events;
create policy org_isolation on public.contract_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_orders
alter table public.variation_orders enable row level security;
alter table public.variation_orders force  row level security;
drop policy if exists org_isolation on public.variation_orders;
create policy org_isolation on public.variation_orders
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_order_lines
alter table public.variation_order_lines enable row level security;
alter table public.variation_order_lines force  row level security;
drop policy if exists org_isolation on public.variation_order_lines;
create policy org_isolation on public.variation_order_lines
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- variation_order_events (append-only via grants; org-isolated + membership-gated)
alter table public.variation_order_events enable row level security;
alter table public.variation_order_events force  row level security;
drop policy if exists org_isolation on public.variation_order_events;
create policy org_isolation on public.variation_order_events
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- Contracts are frozen once they leave 'draft' (A1): only a whitelisted status
-- transition (issued->signed, issued|signed->terminated) may change the row.
drop trigger if exists trg_contracts_immutable on public.contracts;
create trigger trg_contracts_immutable
  before update or delete on public.contracts
  for each row
  execute function public.enforce_immutable_when(
    'status',
    'issued,signed,terminated',
    'signed,terminated'
  );

-- Contract sections + lines can only be mutated while the parent contract is 'draft'.
drop trigger if exists trg_contract_sections_parent_draft on public.contract_sections;
create trigger trg_contract_sections_parent_draft
  before insert or update or delete on public.contract_sections
  for each row
  execute function public.enforce_contract_child_draft();

drop trigger if exists trg_contract_lines_parent_draft on public.contract_lines;
create trigger trg_contract_lines_parent_draft
  before insert or update or delete on public.contract_lines
  for each row
  execute function public.enforce_contract_child_draft();

-- Variation orders are frozen once they leave 'draft' (A2): only a whitelisted
-- status transition (internal_approved->issued, issued->approved|rejected) allowed.
drop trigger if exists trg_variation_orders_immutable on public.variation_orders;
create trigger trg_variation_orders_immutable
  before update or delete on public.variation_orders
  for each row
  execute function public.enforce_immutable_when(
    'status',
    'internal_approved,issued,approved,rejected',
    'issued,approved,rejected'
  );

-- Variation order lines can only be mutated while the parent VO is 'draft'.
drop trigger if exists trg_variation_order_lines_parent_draft on public.variation_order_lines;
create trigger trg_variation_order_lines_parent_draft
  before insert or update or delete on public.variation_order_lines
  for each row
  execute function public.enforce_variation_child_draft();

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

-- =============================================================================
-- P1 Automation — notifications (recipient-scoped) + automation config/claim log
-- =============================================================================

-- notifications: a member sees ONLY their own rows (recipient-scoped USING), but
-- an authorized member (e.g. the runner-as-owner) may INSERT for ANY recipient
-- in the org (WITH CHECK is org + membership only).
alter table public.notifications enable row level security;
alter table public.notifications force  row level security;
drop policy if exists org_isolation on public.notifications;
create policy org_isolation on public.notifications
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
    and recipient_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- automation_settings (standard org_isolation)
alter table public.automation_settings enable row level security;
alter table public.automation_settings force  row level security;
drop policy if exists org_isolation on public.automation_settings;
create policy org_isolation on public.automation_settings
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- api_keys (Public API v1; standard org_isolation — the row is only ever read
-- under an org context by settings; the pre-context Bearer resolution goes through
-- the SECURITY DEFINER app_api_key_by_hash, which is not RLS-filtered)
alter table public.api_keys enable row level security;
alter table public.api_keys force  row level security;
drop policy if exists org_isolation on public.api_keys;
create policy org_isolation on public.api_keys
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- automation_run_log (append-only via grants; standard org_isolation)
alter table public.automation_run_log enable row level security;
alter table public.automation_run_log force  row level security;
drop policy if exists org_isolation on public.automation_run_log;
create policy org_isolation on public.automation_run_log
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );

-- Proposals are frozen once they leave 'draft': only a whitelisted status
-- transition may change the row (nothing else), enforced by the shared factory.
drop trigger if exists trg_proposals_immutable on public.proposals;
create trigger trg_proposals_immutable
  before update or delete on public.proposals
  for each row
  execute function public.enforce_immutable_when(
    'status',
    'sent,accepted,rejected,expired,superseded',
    'accepted,rejected,expired,superseded'
  );

-- Sections + lines can only be mutated while their parent proposal is 'draft'.
drop trigger if exists trg_proposal_sections_parent_draft on public.proposal_sections;
create trigger trg_proposal_sections_parent_draft
  before insert or update or delete on public.proposal_sections
  for each row
  execute function public.enforce_proposal_child_draft();

drop trigger if exists trg_proposal_lines_parent_draft on public.proposal_lines;
create trigger trg_proposal_lines_parent_draft
  before insert or update or delete on public.proposal_lines
  for each row
  execute function public.enforce_proposal_child_draft();
