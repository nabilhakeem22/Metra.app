-- rls/policies/20-proposals.sql — proposals and their children.
--
-- One of the policies/* files apply-rls runs LAST, in the order
-- rls/manifest.ts declares. Every statement here is idempotent
-- (`drop ... if exists` / `create or replace` / `alter table ... enable`).
-- A table's triggers live in the SAME file as its policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

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
