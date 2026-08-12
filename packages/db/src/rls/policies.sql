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

-- proposal_section_library (create-on-use section-title suggestions)
alter table public.proposal_section_library enable row level security;
alter table public.proposal_section_library force  row level security;
drop policy if exists org_isolation on public.proposal_section_library;
create policy org_isolation on public.proposal_section_library
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
