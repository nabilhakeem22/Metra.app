-- 0047 — a claim's status and its resolution columns must agree. SCHEMA ONLY:
-- one CHECK constraint. Idempotent, no data touched, no apply-rls object
-- referenced.
--
-- THE PROBLEM. client_payment_claims is the one table in this schema with a
-- MUTABLE status lifecycle, and its resolution facts live in three separate
-- nullable columns (resolved_at, resolved_by, confirmed_payment_event_id).
-- Nothing in the database tied them to `status`. A confirmed claim with a NULL
-- confirmed_payment_event_id is a claim the studio believes is paid with no
-- ledger row behind it; a pending claim carrying a resolved_at is a claim
-- someone half-resolved. Both read as money in the cockpit and neither could be
-- distinguished from a real one after the fact. The application already gets
-- this right in one transaction per resolution, but "the only writer is careful"
-- is not an invariant, it is a hope.
--
-- The constraint is a CASE over status::text rather than three ORed predicates
-- so a NEW status value added to the enum later is UNCONSTRAINED (ELSE true)
-- rather than silently rejected by an ALTER TYPE that never mentioned it.
--
-- NOT VALID then VALIDATE, in two statements. NOT VALID takes only a SHARE ROW
-- EXCLUSIVE lock and constrains every future write immediately; VALIDATE scans
-- the existing rows without blocking writers. A pre-flight count of the rows
-- this would reject was run READ-ONLY against the shared database before this
-- migration was written and returned 0 of 19 claim rows, so the VALIDATE is
-- safe to keep in the chain and a fresh CI database validates an empty table.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_payment_claims_resolution') THEN
  ALTER TABLE public.client_payment_claims ADD CONSTRAINT client_payment_claims_resolution CHECK (
    CASE status::text
      WHEN 'pending'   THEN resolved_at IS NULL AND resolved_by IS NULL AND confirmed_payment_event_id IS NULL
      WHEN 'dismissed' THEN resolved_at IS NOT NULL
      WHEN 'confirmed' THEN resolved_at IS NOT NULL AND confirmed_payment_event_id IS NOT NULL
      ELSE true END) NOT VALID;
END IF; END $$;
--> statement-breakpoint
ALTER TABLE public.client_payment_claims VALIDATE CONSTRAINT client_payment_claims_resolution;
