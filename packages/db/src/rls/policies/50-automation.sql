-- rls/policies/50-automation.sql — notifications, automation config and run log, api keys, entitlements.
--
-- One of the policies/* files apply-rls runs LAST, in the order
-- rls/manifest.ts declares. Every statement here is idempotent
-- (`drop ... if exists` / `create or replace` / `alter table ... enable`).
-- A table's triggers live in the SAME file as its policies.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

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

-- workspace_entitlements (Epic A2; per-workspace flow/limit/feature grant —
-- standard org_isolation, copied verbatim from the engagement_change_orders
-- block). Full DML granted (a plan change edits the row); NEVER written via
-- INSERT ... ON CONFLICT DO UPDATE during bootstrap — the UPDATE arm pulls in
-- this policy's USING (membership second factor), which is false before the owner
-- membership exists.
alter table public.workspace_entitlements enable row level security;
alter table public.workspace_entitlements force  row level security;
drop policy if exists org_isolation on public.workspace_entitlements;
create policy org_isolation on public.workspace_entitlements
  using (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  )
  with check (
    org_id = nullif(current_setting('app.current_org_id', true), '')::uuid
    and public.app_is_current_org_member()
  );
