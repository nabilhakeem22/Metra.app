import type { EngagementTransitionRecord } from '@/lib/engagements/queries';
import type { OfflineApprovalChannel } from '@/lib/engagements/offline-approval';

// What each row of the timeline READS as. PURE and server-safe: the sentences
// come from the catalogue through `TimelineLabels`; this decides which one.

/** The sentences the feed needs from the catalogue, as functions. */
export interface TimelineLabels {
  transition(fromState: string | null, toState: string | null): string;
  /** A move Metra made with no person behind it (a ledger row with no actor). */
  byMetra(move: string): string;
  /** The design-only delivery closed by the client's handover confirmation. */
  closedOnClientConfirmation(): string;
  eventKind(kind: string): string;
  clientActivity(kind: string, actorName: string | null): string;
  /** "By phone", "On WhatsApp"...: how the client gave an offline approval. */
  offlineChannel(channel: OfflineApprovalChannel): string;
}

/**
 * A transition's sentence. A row with NO actor is a move Metra made as the
 * consequence of an act (lib/engagements/executor/consequence.ts), and says so:
 * the client's handover confirmation closing the delivery reads as exactly that.
 */
export function transitionLabel(transition: EngagementTransitionRecord, labels: TimelineLabels): string {
  const move = labels.transition(transition.fromState, transition.toState);
  if (transition.actorUserId !== null) return move;
  if (transition.trigger === 'recipientAcknowledges') return labels.closedOnClientConfirmation();
  return labels.byMetra(move);
}
