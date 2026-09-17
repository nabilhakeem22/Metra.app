-- rls/functions/20-api-keys.sql — the Public API v1 key resolver.
--
-- One of the functions/* files apply-rls runs, in the order rls/manifest.ts
-- declares. Postgres validates a `language sql` body at CREATE time, so a
-- callee must be created before its caller ACROSS files as well as within one:
-- do not reorder the manifest, and never split inside a function.
-- rls/**.sql is exempt from the 150-line rule (stack-profile.md).

-- =============================================================================
-- Public API keys (v1) — live-role resolver
-- =============================================================================

-- Resolve a public API key by its sha256 token hash, BEFORE any org context
-- exists (the request only carries a Bearer key). SECURITY DEFINER bypasses FORCE
-- RLS but returns at most the single matching key — and ONLY when it is LIVE:
--   * not revoked (revoked_at is null)
--   * not expired (expires_at is null or in the future)
--   * its creator (created_by) is a CURRENT member of the key's org
-- The role returned is the creator's LIVE membership role (an INNER JOIN on
-- memberships), so a role change is reflected immediately and losing membership
-- resolves the key to null (the caller maps that to 401). Cost/margin visibility
-- is NOT stored here — it is derived per-request from canSeeMargin(role, ...).
create or replace function public.app_api_key_by_hash(p_hash text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'key_id', k.id,
    'org_id', k.org_id,
    'principal_user_id', k.created_by,
    'role', m.role
  )
  from public.api_keys k
  join public.memberships m
    on m.org_id = k.org_id
   and m.user_id = k.created_by
  where k.token_hash = p_hash
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > now());
$$;

-- Throttled last_used_at stamp. SECURITY DEFINER (called before org context) but
-- scoped to the exact key hash; updates only when the stored value is null or
-- older than the passed cutoff, so there is no DB write per request. Returns
-- nothing meaningful; best-effort via ctx.waitUntil on the caller.
create or replace function public.app_touch_api_key(p_hash text, p_cutoff timestamptz)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.api_keys
     set last_used_at = now()
   where token_hash = p_hash
     and (last_used_at is null or last_used_at < p_cutoff);
$$;
