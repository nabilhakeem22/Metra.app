import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import {
  isClientGenerated,
  isRecordedOnBehalf,
} from '@/lib/engagements/event-provenance';

// WHAT THE TIMELINE SHOWS, and in what order. PURE and server-safe: no React, no
// db. Merging three record streams into one ledger, deciding which rows are
// skipped and which are drawn ON another row, is the part of this tab somebody
// would count in a dispute — so it is the part that has to be callable.

/** One row of the merged ledger. */
export interface TimelineEntry {
  id: string;
  at: string | Date;
  label: string;
  note: string | null;
  /** The studio asserting somebody ELSE acted. */
  onBehalf: boolean;
  occurredOn: string | Date | null;
  evidence: string | null;
  eventId: string | null;
  /** The correction that retracted this row, drawn ON it. */
  retraction: EngagementEventRecord | null;
}

/** The three sentences the feed needs from the catalogue, as functions. */
export interface TimelineLabels {
  transition(fromState: string | null, toState: string | null): string;
  eventKind(kind: string): string;
  clientActivity(kind: string, actorName: string | null): string;
}

export interface TimelineInput {
  transitions: readonly EngagementTransitionRecord[];
  events: readonly EngagementEventRecord[];
  clientActivity: readonly EngagementClientActivityRecord[];
}

/**
 * A ledger row's free-text note, blank-safe: whitespace-only (or absent) reads as
 * "no note" so the timeline never renders an empty quoted line.
 */
export function trimmedNote(note: string | null | undefined): string | null {
  return note?.trim() || null;
}

/**
 * Which rows a correction has retracted, and why. Read from the SAME array the
 * guards filter with `liveEvents` — this view deliberately keeps the retracted row
 * VISIBLE (that history IS the protection) and marks it, rather than hiding it as
 * the guards do.
 */
function retractionsByTarget(
  events: readonly EngagementEventRecord[],
): Map<string, EngagementEventRecord> {
  return new Map(
    events
      .filter((event) => event.supersedesEventId !== null)
      .map((event) => [event.supersedesEventId as string, event]),
  );
}

function transitionEntry(
  transition: EngagementTransitionRecord,
  labels: TimelineLabels,
): TimelineEntry {
  return {
    id: `t-${transition.id}`,
    at: transition.decidedAt,
    label: labels.transition(transition.fromState, transition.toState),
    note: trimmedNote(transition.note),
    onBehalf: false,
    occurredOn: null,
    evidence: null,
    eventId: null,
    retraction: null,
  };
}

function eventEntry(
  event: EngagementEventRecord,
  labels: TimelineLabels,
  retractions: Map<string, EngagementEventRecord>,
): TimelineEntry {
  return {
    id: `e-${event.id}`,
    at: event.decidedAt,
    label: labels.eventKind(event.kind),
    note: trimmedNote(event.note),
    onBehalf: isRecordedOnBehalf(event.kind, event.actorChannel),
    occurredOn: event.occurredOn,
    evidence: event.evidence,
    eventId: event.id,
    retraction: retractions.get(event.id) ?? null,
  };
}

function clientEntry(
  entry: EngagementClientActivityRecord,
  index: number,
  labels: TimelineLabels,
): TimelineEntry {
  return {
    id: `c-${entry.kind}-${index}`,
    at: entry.decidedAt,
    label: labels.clientActivity(entry.kind, entry.actorName),
    note: trimmedNote(entry.note),
    onBehalf: false,
    occurredOn: null,
    evidence: null,
    eventId: null,
    retraction: null,
  };
}

/**
 * The merged ledger, newest first.
 *
 * CLIENT-CHANNEL EVENT ROWS ARE SKIPPED, not filtered in the query: they arrive
 * again through `clientActivity`, which carries the actor's NAME. Rendering both
 * drew every genuine client acknowledgement TWICE and made this ledger unreliable
 * to count — which matters, because counting it is what somebody does in a
 * dispute.
 *
 * A CORRECTION is never an entry of its own: it is drawn ON the row it retracts.
 */
export function buildTimelineEntries(
  input: TimelineInput,
  labels: TimelineLabels,
): TimelineEntry[] {
  const retractions = retractionsByTarget(input.events);
  return [
    ...input.transitions.map((transition) => transitionEntry(transition, labels)),
    ...input.events
      .filter((event) => !isClientGenerated(event.actorChannel))
      .filter((event) => event.supersedesEventId === null)
      .map((event) => eventEntry(event, labels, retractions)),
    ...input.clientActivity.map((entry, index) => clientEntry(entry, index, labels)),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
