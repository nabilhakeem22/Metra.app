import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { isClientGenerated, isRecordedForClient } from '@/lib/engagements/event-provenance';
import { offlineApprovalChannelOf, type OfflineApprovalChannel } from '@/lib/engagements/offline-approval';

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
  /** The studio recording what the CLIENT did (an acknowledgement, an offline approval). */
  onBehalf: boolean;
  occurredOn: string | Date | null;
  evidence: string | null;
  eventId: string | null;
  /** The correction that retracted this row, drawn ON it. */
  retraction: EngagementEventRecord | null;
  /** A concept choice's letter position, as SAVED with it (1 = A), else null. */
  optionPosition: number | null;
}

/** The fields a row that is not a studio-recorded event leaves empty. */
const PLAIN_ROW = { onBehalf: false, occurredOn: null, evidence: null, eventId: null, retraction: null };

/** The sentences the feed needs from the catalogue, as functions. */
export interface TimelineLabels {
  transition(fromState: string | null, toState: string | null): string;
  eventKind(kind: string): string;
  clientActivity(kind: string, actorName: string | null): string;
  /** "By phone", "On WhatsApp"...: how the client gave an offline approval. */
  offlineChannel(channel: OfflineApprovalChannel): string;
}

export interface TimelineInput {
  transitions: readonly EngagementTransitionRecord[];
  events: readonly EngagementEventRecord[];
  clientActivity: readonly EngagementClientActivityRecord[];
}

/** A ledger row's note, blank-safe: whitespace-only reads as "no note". */
export function trimmedNote(note: string | null | undefined): string | null {
  return note?.trim() || null;
}

/**
 * Which rows a correction has retracted, and why. The guards drop a retracted
 * row (`liveEvents`); this view keeps it VISIBLE and marks it: that history IS
 * the protection.
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
    ...PLAIN_ROW,
    optionPosition: null,
  };
}

/** An offline approval's channel code, in the reader's language; other evidence as typed. */
function evidenceOf(event: EngagementEventRecord, labels: TimelineLabels): string | null {
  const channel = offlineApprovalChannelOf(event);
  return channel ? labels.offlineChannel(channel) : event.evidence;
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
    onBehalf: isRecordedForClient(event),
    occurredOn: event.occurredOn,
    evidence: evidenceOf(event, labels),
    eventId: event.id,
    retraction: retractions.get(event.id) ?? null,
    optionPosition: event.chosenPosition,
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
    ...PLAIN_ROW,
    optionPosition: entry.chosenPosition,
  };
}

/**
 * The merged ledger, newest first. CLIENT-CHANNEL EVENT ROWS ARE SKIPPED: they
 * arrive again through `clientActivity`, which carries the actor's NAME, and
 * drawing both made this ledger (the one counted in a dispute) count every
 * client act TWICE. A CORRECTION is drawn ON the row it retracts, never alone.
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
