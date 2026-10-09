import { isClientGenerated } from '@/lib/engagements/event-provenance';
import type { EngagementEventRecord, EngagementTransitionRecord } from '@/lib/engagements/queries';
import type { OfflineApprovalChannel } from '@/lib/engagements/offline-approval';

// What each row of the timeline READS as. PURE and server-safe: the sentences
// come from the catalogue through `TimelineLabels`; this decides which one.

/** The sentences the feed needs from the catalogue, as functions. */
export interface TimelineLabels {
  transition(fromState: string | null, toState: string | null): string;
  /** A move Metra made with no person behind it (a ledger row with no actor). */
  byMetra(move: string): string;
  /** The design-only delivery closed by the client's own handover confirmation. */
  closedOnClientConfirmation(): string;
  /** The design-only delivery closed when the studio recorded the client's confirmation. */
  closedOnRecordedConfirmation(): string;
  eventKind(kind: string): string;
  clientActivity(kind: string, actorName: string | null): string;
  /** "By phone", "On WhatsApp"...: how the client gave an offline approval. */
  offlineChannel(channel: OfflineApprovalChannel): string;
}

/**
 * A transition's sentence. A row with NO actor is a move Metra made as the
 * consequence of an act (lib/engagements/executor/consequence.ts), and says so:
 * the handover close names whose confirmation closed it, the client's own or one
 * the studio recorded for them (`handoverConfirmedBy`).
 */
export function transitionLabel(
  transition: EngagementTransitionRecord,
  labels: TimelineLabels,
  handoverConfirmedBy: 'client' | 'studio',
): string {
  const move = labels.transition(transition.fromState, transition.toState);
  if (transition.actorUserId !== null) return move;
  if (transition.trigger === 'recipientAcknowledges') {
    return handoverConfirmedBy === 'client'
      ? labels.closedOnClientConfirmation()
      : labels.closedOnRecordedConfirmation();
  }
  return labels.byMetra(move);
}

/** Who gave the live (not retracted) handover confirmation: the client, or the studio for them. */
export function handoverConfirmedBy(events: readonly EngagementEventRecord[]): 'client' | 'studio' {
  const retracted = new Set(events.map((event) => event.supersedesEventId).filter(Boolean));
  const live = events
    .filter((event) => event.kind === 'handoff_acknowledgement' && !retracted.has(event.id))
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime());
  return live.length === 0 || isClientGenerated(live[0].actorChannel) ? 'client' : 'studio';
}
