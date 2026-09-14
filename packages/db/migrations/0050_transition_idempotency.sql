-- 0050 — a retried self-loop must not fire twice. SCHEMA ONLY: one nullable text
-- column + one partial unique index. Additive, idempotent, no backfill, no
-- apply-rls object referenced.
--
-- THE PROBLEM. A self-loop transition (requestRevision, attestAsBuiltClean) has
-- no admission gate to protect it: an advancing edge is guarded by its own
-- from-state, so a second attempt finds the engagement already moved and does
-- nothing, but a self-loop leaves the state exactly where it was. Every retry is
-- therefore a fresh, valid request. The retry that matters is not a double-click
-- — the UI already blocks that — it is the UNCERTAIN one: the request reached
-- Postgres, the transaction committed, and the response never made it back over
-- a phone network. The studio taps again, and the engagement burns a second free
-- revision or records a second attestation for one act.
--
-- idempotency_key is the client's name for THE ATTEMPT, so the server can tell a
-- retry of one act from a genuine second act. Nullable, because every advancing
-- edge and every pre-existing row legitimately has none, and because the column
-- must be optional for old callers to keep working while this deploys.
--
-- The index is PARTIAL on IS NOT NULL: NULLs do not collide in a unique index
-- anyway, but stating it makes the intent explicit and keeps the index to the
-- rows that actually carry a key. It is keyed on (org_id, engagement_id, key) —
-- org_id first because every read is tenant-scoped, and the engagement because a
-- key is only ever meaningful within one.
--
-- lock_timeout: ADD COLUMN of a nullable text is a catalogue-only change in PG11+
-- (no table rewrite), but it still needs a brief ACCESS EXCLUSIVE lock. 3s makes
-- it fail fast with 55P03 behind a long reader rather than queue every writer
-- behind it; both statements are IF NOT EXISTS, so a re-run is safe.
--
-- RLS/grants unchanged: org_isolation and the append-only INSERT+SELECT grants
-- already cover a new column, and an index carries no privileges.
DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  ALTER TABLE public.engagement_transitions ADD COLUMN IF NOT EXISTS idempotency_key text;
  CREATE UNIQUE INDEX IF NOT EXISTS engagement_transitions_idempotency_key_uniq
    ON public.engagement_transitions (org_id, engagement_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
END $$;
