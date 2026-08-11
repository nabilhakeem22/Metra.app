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
