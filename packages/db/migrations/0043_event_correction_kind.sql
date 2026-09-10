-- 0043 — provenance and corrections on the approvals ledger. SCHEMA ONLY: one
-- enum ADD VALUE, three nullable columns, one self-referential same-org FK, two
-- CHECKs, one partial index. Additive and idempotent; no backfill, no data
-- touched, no apply-rls object referenced.
--
-- THE PROBLEM. Metra's value is evidentiary — append-only issuance, recipient
-- acknowledgement, watermarked Issued-for-Construction PDFs. But a studio can
-- record an acknowledgement ON THE CLIENT'S BEHALF, for one given on a call, and
-- the resulting row is today indistinguishable in the interface from one the
-- client generated themselves. `actor_channel` already separates them at the data
-- layer ('staff' vs 'client') and no surface selects it — that half needs no
-- migration, only a wider SELECT. What needs one is everything the record cannot
-- currently say.
--
-- occurred_on — THE SECOND DATE. `decided_at` is when the studio typed it. That is
--   not when the client confirmed, and a record dated "today" for a call last
--   Thursday is the weakest possible evidence. NULL means the two coincide, which
--   is exactly the client-channel case, so no existing row is wrong by omission.
--
--   It is a DATE, not a timestamptz, deliberately. A human recording "she
--   confirmed on the 6th" knows a day, not an instant — and a timestamptz invites
--   an ordering CHECK against decided_at that breaks in Egypt: a studio recording
--   at 01:00 local (UTC+3) is at 22:00 UTC the PREVIOUS day, so an honest "it
--   happened today" would be stamped AFTER decided_at and rejected. A date has no
--   such trap, and there is no ordering CHECK for the same reason.
--
-- evidence — HOW it was confirmed: a phone call, a WhatsApp message, a signature
--   on paper. Separate from `note` because a reader needs to see the basis as a
--   basis rather than as a comment that might be anything. Free text, never parsed.
--
-- supersedes_event_id — THE CORRECTION POINTER. `engagement_events` grants SELECT
--   and INSERT and nothing else, which is the right posture for an evidentiary
--   ledger and is not being relaxed — but it left no answer to the obvious
--   question: what happens when a wrong row lands? A duplicated `rom_range_set`
--   from a double-click, an acknowledgement against the wrong engagement, a band
--   typed with a missing zero. The answer is the accounting one: a correction is a
--   NEW row pointing at the row it retracts, so the ledger only grows and the
--   mistake stays visible beside its retraction — which is what a reader six
--   months later actually needs.
--
-- WHY THE CHECKS COMPARE `kind::text`. PG refuses to let a transaction USE an enum
-- value that same transaction added ("unsafe use of new value"). Splitting the
-- ADD VALUE into its own FILE does not help: the Drizzle migrator does not
-- guarantee a transaction per file, and an earlier attempt at exactly that split
-- failed on this error. Casting the column to text compares text to text, so the
-- new label is never resolved as an enum value and the constraint is safe in the
-- same transaction that creates it. The predicate is identical either way —
-- `kind::text` is the enum's label.
--
-- WHAT IS NOT HERE, on purpose. The client counter-signal — showing the client
-- "your studio recorded that you approved on 6 September" and letting them dispute
-- it — needs `client_notified_at` and `disputed_at`, and needs portal work to mean
-- anything. Adding the columns now would be dead schema until that ships, so they
-- land with it.
--
-- RLS/grants unchanged: the existing org_isolation policy and the SELECT+INSERT
-- grants cover new columns without amendment, and nothing here is UPDATE-able, so
-- the append-only guarantee is intact.
ALTER TYPE public.engagement_event_kind ADD VALUE IF NOT EXISTS 'event_correction';
--> statement-breakpoint
ALTER TABLE public.engagement_events
  ADD COLUMN IF NOT EXISTS occurred_on date,
  ADD COLUMN IF NOT EXISTS evidence text,
  ADD COLUMN IF NOT EXISTS supersedes_event_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  -- Same-org self-reference, so correcting across tenants is impossible at the
  -- database rather than in a query someone might forget to write. RESTRICT, not
  -- CASCADE: deleting a corrected row would take its correction with it and leave
  -- the ledger claiming the mistake never happened.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_supersedes_same_org_fk'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_supersedes_same_org_fk
      FOREIGN KEY (org_id, supersedes_event_id)
      REFERENCES public.engagement_events (org_id, id)
      ON DELETE RESTRICT;
  END IF;

  -- Only a correction may correct. Without this, any kind could quietly carry a
  -- pointer and every reader would have to defend against it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_supersedes_only_correction'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_supersedes_only_correction
      CHECK (supersedes_event_id IS NULL OR kind::text = 'event_correction');
  END IF;

  -- A correction exists to point at something. One with no target is a row that
  -- says "something was wrong" without saying which thing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'engagement_events_correction_needs_target'
  ) THEN
    ALTER TABLE public.engagement_events
      ADD CONSTRAINT engagement_events_correction_needs_target
      CHECK (kind::text <> 'event_correction' OR supersedes_event_id IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
-- Every reader that must exclude corrected rows asks the same question: is there
-- a correction pointing at this id? Partial, because the answer is NULL for
-- almost every row in the table.
CREATE INDEX IF NOT EXISTS engagement_events_supersedes_idx
  ON public.engagement_events (org_id, supersedes_event_id)
  WHERE supersedes_event_id IS NOT NULL;
