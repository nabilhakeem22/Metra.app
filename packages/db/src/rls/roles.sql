-- metra_app: the request-time identity. NOLOGIN + NOBYPASSRLS so it can never
-- see across tenants. The connection role (postgres) OWNS the tables and would
-- bypass RLS, which is why every table also has FORCE ROW LEVEL SECURITY and why
-- the app switches into metra_app via `SET LOCAL ROLE metra_app` per request.
-- Idempotent: safe to re-run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'metra_app') then
    create role metra_app nologin noinherit nobypassrls;
  end if;
end
$$;

-- Let the connection role switch into metra_app.
grant metra_app to postgres;

grant usage on schema public to metra_app;

-- accounts (Epic A, A1): SELECT ONLY. metra_app reads its own account via the
-- account_isolation policy; accounts are CREATED exclusively through the SECURITY
-- DEFINER app_bootstrap_account() (granted below), never by a direct metra_app
-- INSERT — no INSERT/UPDATE/DELETE grant, and the policy's WITH CHECK is false.
grant select on public.accounts to metra_app;

-- Full DML on business tables...
grant select, insert, update, delete on public.organizations to metra_app;
grant select, insert, update, delete on public.memberships   to metra_app;
grant select, insert, update, delete on public.files         to metra_app;
grant select, insert, update, delete on public.invitations   to metra_app;

grant select, insert, update, delete on public.sections      to metra_app;
grant select, insert, update, delete on public.cost_items    to metra_app;
grant select, insert, update, delete on public.clients       to metra_app;
grant select, insert, update, delete on public.client_contacts to metra_app;
grant select, insert, update, delete on public.activities    to metra_app;
grant select, insert, update, delete on public.project_types   to metra_app;
grant select, insert, update, delete on public.stage_templates to metra_app;
grant select, insert, update, delete on public.project_stages  to metra_app;
grant select, insert, update, delete on public.projects      to metra_app;
grant select, insert, update, delete on public.proposals         to metra_app;
grant select, insert, update, delete on public.proposal_sections to metra_app;
grant select, insert, update, delete on public.proposal_lines    to metra_app;
grant select, insert, update, delete on public.automation_settings to metra_app;
-- Contracts + Variation Orders (P1 Slice 4): full DML on the mutable rows.
grant select, insert, update, delete on public.contracts         to metra_app;
grant select, insert, update, delete on public.contract_sections to metra_app;
grant select, insert, update, delete on public.contract_lines    to metra_app;
grant select, insert, update, delete on public.variation_orders      to metra_app;
grant select, insert, update, delete on public.variation_order_lines to metra_app;
-- Design Engagements (Step 1): the engagement record is mutable (create + Step 2
-- state transitions); the transition ledger is append-only (granted below).
grant select, insert, update on public.design_engagements to metra_app;
-- engagement_milestones (Step 3): the schedule is written ONCE by
-- generateFeeSchedule at submitDesignFee and never edited by any code path, so
-- INSERT-only. This is load-bearing under the Step-14 "absent milestone = free
-- gate" rule: leaving UPDATE/DELETE granted would let a future edit path waive a
-- paying gate by dropping/zeroing its milestone. The revoke removes the earlier
-- (Step 3) UPDATE/DELETE grant on already-provisioned DBs; it is a no-op on a
-- fresh DB. If schedule editing is ever added, re-grant narrowly + gate it with an
-- enforce_immutable_when trigger (immutable once past design_proposal).
grant select, insert on public.engagement_milestones to metra_app;
revoke update, delete on public.engagement_milestones from metra_app;
-- engagement_artifacts (Step 5): artifacts may be re-attested / relabelled, so
-- SELECT + INSERT + UPDATE (not append-only) — but never DELETE.
grant select, insert, update on public.engagement_artifacts to metra_app;
-- engagement_change_orders (Step 8): a change order is raised (insert) then later
-- settled (update, reserved for the Step-9 revision_co settle path). SELECT +
-- INSERT + UPDATE — never DELETE.
grant select, insert, update on public.engagement_change_orders to metra_app;
-- notifications: recipients read + mark-read (no delete); the runner inserts.
grant select, insert, update on public.notifications to metra_app;
-- api_keys (Public API v1): mint (insert), list (select), revoke + last_used
-- stamp (update). NO delete — revocation sets revoked_at, keys are never removed.
grant select, insert, update on public.api_keys to metra_app;

-- ...except audit_log and the append-only logs (price history, proposal events,
-- the automation idempotency claim log). No UPDATE / DELETE grant, so any attempt
-- raises a permission error at the database.
grant select, insert on public.audit_log          to metra_app;
grant select, insert on public.price_changes       to metra_app;
grant select, insert on public.price_change_lines  to metra_app;
grant select, insert on public.proposal_events     to metra_app;
grant select, insert on public.contract_events         to metra_app;
grant select, insert on public.variation_order_events  to metra_app;
grant select, insert on public.engagement_transitions  to metra_app;
-- payment_events (Step 4): the manual finance ledger is append-only — a recorded
-- payment is a cleared payment and is never edited or removed. SELECT + INSERT
-- only, so any UPDATE/DELETE raises a permission error at the database.
grant select, insert on public.payment_events          to metra_app;
-- engagement_events (Step 7): the approvals ledger is append-only — a recorded
-- decision (concept_approval, …) is never edited or removed. SELECT + INSERT only,
-- so any UPDATE/DELETE raises a permission error at the database.
grant select, insert on public.engagement_events       to metra_app;
grant select, insert on public.automation_run_log  to metra_app;

-- Future-proofing for composite-FK trigger functions.
grant execute on function public.enforce_same_org() to metra_app;

-- Immutability trigger factory (status-locked business rows).
grant execute on function public.enforce_immutable_when() to metra_app;

-- Proposals (P1 Slice 3): child-draft guard trigger fn + public token SDFs. The
-- token functions run on the PUBLIC accept path (no session) via the base
-- connection role, and are also grantable to metra_app for authenticated callers.
grant execute on function public.enforce_proposal_child_draft() to metra_app;
grant execute on function public.app_proposal_by_token(text) to metra_app;
grant execute on function public.app_proposal_respond_by_token(text, text, text, text, text) to metra_app;

-- Contracts + Variation Orders (P1 Slice 4): child-draft guard trigger fns + the
-- public token SDFs. The token functions run on the PUBLIC path (no session) via
-- the base connection role, and are grantable to metra_app for authenticated
-- callers too.
grant execute on function public.enforce_contract_child_draft() to metra_app;
grant execute on function public.enforce_variation_child_draft() to metra_app;
grant execute on function public.app_contract_by_token(text) to metra_app;
grant execute on function public.app_contract_ack_by_token(text, text, text, text, text) to metra_app;
grant execute on function public.app_variation_by_token(text) to metra_app;
grant execute on function public.app_variation_respond_by_token(text, text, text, text, text) to metra_app;

-- Bootstrap user->org lookup (SECURITY DEFINER, scoped to app.current_user_id).
-- Least privilege: CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoke
-- that (and the Supabase api roles where they exist) so ONLY metra_app can call
-- this bypass-RLS function. Guarded so it is safe on a plain Postgres (CI) where
-- anon/authenticated/service_role do not exist.
grant execute on function public.app_current_user_memberships() to metra_app;
revoke execute on function public.app_current_user_memberships() from public;

-- Invitation-by-token lookup (SECURITY DEFINER); same least-privilege treatment.
grant execute on function public.app_invitation_by_token(text) to metra_app;
revoke execute on function public.app_invitation_by_token(text) from public;

-- Current-user orgs (SECURITY DEFINER); same least-privilege treatment.
grant execute on function public.app_current_user_orgs() to metra_app;
revoke execute on function public.app_current_user_orgs() from public;

-- Membership second-factor helpers for RLS (SECURITY DEFINER); same treatment.
grant execute on function public.app_is_current_org_member() to metra_app;
revoke execute on function public.app_is_current_org_member() from public;
grant execute on function public.app_can_bootstrap_membership() to metra_app;
revoke execute on function public.app_can_bootstrap_membership() from public;
grant execute on function public.app_claim_invitation(uuid) to metra_app;
revoke execute on function public.app_claim_invitation(uuid) from public;

-- Account bootstrap (Epic A, A1) — the ONLY path that creates an account row
-- (SECURITY DEFINER, BYPASSRLS owner). Same least-privilege treatment: metra_app
-- only, revoke the default PUBLIC execute (+ the Supabase api roles in the guarded
-- loop below), so anon/authenticated/service_role/public can never call it.
grant execute on function public.app_bootstrap_account(text, text) to metra_app;
revoke execute on function public.app_bootstrap_account(text, text) from public;

-- Public API key resolver + last-used stamp (SECURITY DEFINER, live-role model);
-- same least-privilege treatment. Only metra_app may call them; never anon/public.
grant execute on function public.app_api_key_by_hash(text) to metra_app;
revoke execute on function public.app_api_key_by_hash(text) from public;
grant execute on function public.app_touch_api_key(text, timestamptz) to metra_app;
revoke execute on function public.app_touch_api_key(text, timestamptz) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke execute on function public.app_current_user_memberships() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_invitation_by_token(text) from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_current_user_orgs() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_is_current_org_member() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_can_bootstrap_membership() from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_claim_invitation(uuid) from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_bootstrap_account(text, text) from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_api_key_by_hash(text) from %I',
        r
      );
      execute format(
        'revoke execute on function public.app_touch_api_key(text, timestamptz) from %I',
        r
      );
    end if;
  end loop;
end
$$;
