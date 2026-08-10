-- Row-Level Security: enable + FORCE on every business table, with a single
-- isolation policy keyed to the request-scoped `app.current_org_id` GUC.
--
-- `nullif(current_setting('app.current_org_id', true), '')` yields NULL when the
-- GUC is unset OR reset to '' (a Postgres quirk: once a custom GUC is set on a
-- session/pooled connection, it reverts to '' rather than NULL). Casting that to
-- uuid gives NULL, so every predicate is `org_id = NULL` = false => 0 rows.
-- Fails closed instead of raising on the empty string. Idempotent.

-- organizations: no org_id column; the tenant boundary is its own id.
alter table public.organizations enable row level security;
alter table public.organizations force  row level security;
drop policy if exists org_isolation on public.organizations;
create policy org_isolation on public.organizations
  using      (id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- memberships
alter table public.memberships enable row level security;
alter table public.memberships force  row level security;
drop policy if exists org_isolation on public.memberships;
create policy org_isolation on public.memberships
  using      (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- NOTE: memberships intentionally has ONLY the strict org-isolation policy —
-- identical to every other business table, no widening. The pre-context
-- user->org bootstrap is done by the SECURITY DEFINER function
-- public.app_current_user_memberships() (functions.sql), NOT a permissive policy.
-- (An earlier self_memberships policy was removed: permissive policies are OR'd,
-- so `org_id = current_org OR user_id = current_user` leaked a multi-org user's
-- other-org membership row under one org's context.)
drop policy if exists self_memberships on public.memberships;

-- files
alter table public.files enable row level security;
alter table public.files force  row level security;
drop policy if exists org_isolation on public.files;
create policy org_isolation on public.files
  using      (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- audit_log (append-only via grants; still org-isolated for reads/inserts)
alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;
drop policy if exists org_isolation on public.audit_log;
create policy org_isolation on public.audit_log
  using      (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);

-- invitations
alter table public.invitations enable row level security;
alter table public.invitations force  row level security;
drop policy if exists org_isolation on public.invitations;
create policy org_isolation on public.invitations
  using      (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid)
  with check (org_id = nullif(current_setting('app.current_org_id', true), '')::uuid);
