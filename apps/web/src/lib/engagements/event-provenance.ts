// Who actually performed a recorded act. PURE and CLIENT-SAFE (the
// `inline-dropzone-category.ts` pattern): no db, no server-only, so the Timeline
// renders it and a unit test reads it without a React tree.
//
// THE LEDGER ALWAYS KNEW; THE INTERFACE DID NOT. `engagement_events.actor_channel`
// has separated a client-generated record from a studio-recorded one since 0033,
// and `getEngagementEvents` never selected it — so the Timeline drew both as the
// same unlabelled line. For a product whose value is evidentiary, that is the
// weakest thing in it: `romAcknowledged` is satisfied by either, so a studio can
// clear Gate B and the page gives a reviewer nothing to question.
import type { EngagementEventKind } from '@metra/db';

/** The channel column's two values. Anything not `client` was typed by staff. */
export const CLIENT_CHANNEL = 'client';

/**
 * The acts that are the CLIENT'S to perform, and which the studio can therefore
 * only ever record ON THEIR BEHALF.
 *
 * Deliberately just these two. They are the ones with an explicit staff stand-in
 * path — `recordRomAcknowledgementCore` and `recordHandoffAcknowledgementCore` —
 * and an acknowledgement is by definition somebody else's act. Every other
 * staff-channel kind is the studio recording its OWN work (issuing a band,
 * attesting an as-built, approving a design), which needs no such marking and
 * would only cry wolf if it carried it.
 */
export const ON_BEHALF_KINDS: ReadonlySet<EngagementEventKind> =
  new Set<EngagementEventKind>(['rom_acknowledgement', 'handoff_acknowledgement']);

/**
 * Drop every event a correction has retracted, and the corrections themselves.
 *
 * THIS IS WHAT MAKES A CORRECTION MEAN ANYTHING. `engagement_events` grants
 * INSERT and SELECT and nothing else, so a wrong row cannot be deleted -- 0043's
 * answer is the accounting one, a NEW row pointing at the row it retracts. But a
 * pointer nothing reads is decoration: until the guards skip the retracted row,
 * a mistake you have formally withdrawn still unlocks shop drawings.
 *
 * `event_correction` rows are dropped too. They are bookkeeping about the ledger,
 * not events in it, and no guard should ever count one.
 *
 * Generic over the row shape so the guard facts (full db rows) and any narrower
 * read can share one rule rather than each growing their own.
 */
export function liveEvents<
  T extends {
    id: string;
    kind: EngagementEventKind;
    supersedesEventId: string | null;
  },
>(events: T[]): T[] {
  const retracted = new Set(
    events
      .map((e) => e.supersedesEventId)
      .filter((id): id is string => id !== null),
  );
  return events.filter(
    (e) => e.kind !== 'event_correction' && !retracted.has(e.id),
  );
}

/** `YYYY-MM-DD`, the shape a `date` column and an `<input type="date">` agree on. */
const OCCURRED_ON_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a usable "when it actually happened" date?
 *
 * Well-formed, a REAL calendar day (so 2026-02-31 is rejected rather than
 * silently rolled into March), and not in the future — you cannot have already
 * been told something that has not happened yet, and a future date on an
 * evidentiary record is either a typo or a fabrication.
 *
 * It is a DATE and not an instant on purpose: a studio recording "she confirmed
 * on the 6th" knows a day. Comparing days also sidesteps the trap an instant
 * would create in Egypt, where a studio recording at 01:00 local is at 22:00 UTC
 * the previous day — an honest "today" would look like the future.
 */
export function isValidOccurredOn(value: string, todayIso: string): boolean {
  if (!OCCURRED_ON_RE.test(value)) return false;
  // `new Date('2026-02-31')` yields 2026-03-03, so round-trip it to catch a day
  // the calendar does not have.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  return value <= todayIso;
}

/** The client generated this themselves, through their delivery link. */
export function isClientGenerated(actorChannel: string): boolean {
  return actorChannel === CLIENT_CHANNEL;
}

/**
 * The studio recorded this AS the client — an acknowledgement they took on a
 * call, in a message, or on paper.
 *
 * This is the one thing a reader six months into a dispute has to be able to see,
 * so it is computed from the row rather than inferred from how the row looks.
 */
export function isRecordedOnBehalf(
  kind: EngagementEventKind,
  actorChannel: string,
): boolean {
  return !isClientGenerated(actorChannel) && ON_BEHALF_KINDS.has(kind);
}
