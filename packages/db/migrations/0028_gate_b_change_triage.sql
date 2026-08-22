-- 0028 — Gate-B change-triage detour + as-built attestation (Design-Engagement
-- Machine, Step 13). SCHEMA ONLY: two enum ADD VALUEs + one nullable column.
--
-- The two ADD VALUE statements are TOP-LEVEL (NOT wrapped in a DO $$ block): PG
-- forbids ALTER TYPE ... ADD VALUE inside a PL/pgSQL block, and only allows it in
-- the migrator's per-file transaction when the new label is UNUSED in that same
-- transaction. This file deliberately never references 'change_triage' or
-- 'as_built_attestation' (no CHECK, no default, no data row) — so the ADD VALUEs
-- stay unused-in-tx and commit cleanly. Any use of the new labels lands in a
-- LATER migration/step.
--
-- `has_variance` is nullable (only `as_built_attestation` rows carry it: true =
-- variance flagged, false = clean attestation; every other event kind leaves it
-- NULL). RLS/grants are unchanged — the existing engagement_events append-only
-- policy + grants already cover the new column. This migration references NO
-- apply-rls object (no metra_app, no app_* function, no policy).
ALTER TYPE public.design_engagement_state ADD VALUE IF NOT EXISTS 'change_triage';
--> statement-breakpoint
ALTER TYPE public.engagement_event_kind ADD VALUE IF NOT EXISTS 'as_built_attestation';
--> statement-breakpoint
ALTER TABLE public.engagement_events ADD COLUMN IF NOT EXISTS has_variance boolean;
