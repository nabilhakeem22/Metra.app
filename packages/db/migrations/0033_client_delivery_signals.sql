-- 0033 — Client delivery signals (Client Delivery Portal, Phase 2). SCHEMA ONLY:
-- two enum ADD VALUEs + one NOT-NULL-defaulted column + its CHECK + one partial
-- UNIQUE index. Client portal actions are append-only ADVISORY signals — they add
-- a witness row to the existing engagement_events ledger; they NEVER move state
-- and NEVER add a blocking guard (the firm stays in control).
--
-- The two ADD VALUE statements are TOP-LEVEL (NOT wrapped in a DO $$ block): PG
-- forbids ALTER TYPE ... ADD VALUE inside a PL/pgSQL block, and only allows it in
-- the migrator's per-file transaction when the new label is UNUSED in that same
-- transaction. This file deliberately never references 'concept_change_request'
-- or 'design_change_request' (no CHECK, no default, no data row) — so the ADD
-- VALUEs stay unused-in-tx and commit cleanly. Any use of the new labels lands in
-- apply-rls (the write SDF) or later application code.
--
-- `actor_channel` distinguishes a STAFF-recorded event from a CLIENT-recorded one
-- ('staff' default keeps every existing row + every internal writer unchanged).
-- The partial UNIQUE index makes "at most one client signal of a given kind per
-- engagement" atomic at the database level — the write SDF's `exists` pre-check
-- races two concurrent identical clicks, and this index is the backstop.
--
-- RLS/grants are unchanged — the existing engagement_events append-only policy +
-- grants already cover the new column. This migration references NO apply-rls
-- object (no metra_app, no app_* function, no policy).
ALTER TYPE public.engagement_event_kind ADD VALUE IF NOT EXISTS 'concept_change_request';
--> statement-breakpoint
ALTER TYPE public.engagement_event_kind ADD VALUE IF NOT EXISTS 'design_change_request';
--> statement-breakpoint
ALTER TABLE public.engagement_events
  ADD COLUMN IF NOT EXISTS actor_channel text NOT NULL DEFAULT 'staff';
--> statement-breakpoint
ALTER TABLE public.engagement_events
  ADD CONSTRAINT engagement_events_actor_channel_check
  CHECK (actor_channel IN ('client', 'staff'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS engagement_events_client_signal_unique
  ON public.engagement_events (engagement_id, kind)
  WHERE actor_channel = 'client';
