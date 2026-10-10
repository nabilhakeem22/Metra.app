// The dated timeline of an UNTRUSTED delivery snapshot (Round C, 0058), turned
// into client words. PURE and client-safe.
//
// The SQL returns RAW keys: a machine state on a stage entry, an
// engagement_events kind on a decision. Every one is translated here (a state
// into its PORTAL_STAGE_KEY, a kind into a decision word), so the raw key never
// reaches the browser. Anything unknown or malformed (a state or kind added to
// the database but not mapped here, a bad instant, a bad amount) DROPS that
// entry; nothing here throws. The order is the SQL's (newest first, a stage
// before the decision or payment that caused it at the same instant).
import { conceptLetter } from '../concept-letter';
import { PORTAL_STAGE_KEY } from '../portal-stage';
import type { DesignState } from '../states';
import { STATE_SET } from './row-guards';
import { isoInstant, positiveAmount } from './snapshot-values';
import type { PortalPaymentKind, PortalTimelineDecision, PortalTimelineEntry } from './timeline-types';

/** The SQL returns at most 60; a longer array is cut, never trusted. */
export const TIMELINE_MAX_ENTRIES = 60;

/** engagement_events kind -> the client's word (a concept approval naming an option is a choice). */
const DECISION_OF_KIND: Readonly<Record<string, PortalTimelineDecision>> = {
  concept_approval: 'concept_approved',
  concept_change_request: 'concept_changes',
  design_approval: 'design_approved',
  design_change_request: 'design_changes',
  rom_acknowledgement: 'budget_acknowledged',
  handoff_acknowledgement: 'handover_acknowledged',
};

const PAYMENT_KINDS: ReadonlySet<string> = new Set<PortalPaymentKind>([
  'deposit',
  'gate_a',
  'gate_b',
  'balance',
  'revision_co',
]);

function stageEntry(row: Record<string, unknown>, at: string): PortalTimelineEntry | null {
  if (typeof row.state !== 'string' || !STATE_SET.has(row.state)) return null;
  return { type: 'stage', stageKey: PORTAL_STAGE_KEY[row.state as DesignState], at };
}

function decisionEntry(row: Record<string, unknown>, at: string): PortalTimelineEntry | null {
  const kind = typeof row.kind === 'string' && Object.hasOwn(DECISION_OF_KIND, row.kind) ? row.kind : null;
  // Who acted decides the wording ("you" or "recorded by your designer"): unknown means drop.
  if (kind === null || typeof row.by_studio !== 'boolean') return null;
  const letter = kind === 'concept_approval' ? conceptLetter(row.option_position) : null;
  return {
    type: 'decision',
    decision: letter ? 'concept_chosen' : DECISION_OF_KIND[kind]!,
    byStudio: row.by_studio,
    letter,
    at,
  };
}

function paymentEntry(row: Record<string, unknown>, at: string): PortalTimelineEntry | null {
  const amount = positiveAmount(row.amount);
  if (typeof row.kind !== 'string' || !PAYMENT_KINDS.has(row.kind) || amount === null) return null;
  return { type: 'payment', kind: row.kind as PortalPaymentKind, amount, at };
}

/** One raw entry in client words, or null when it cannot be shown. */
function timelineEntry(raw: unknown): PortalTimelineEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const at = isoInstant(row.at);
  if (at === null) return null;
  switch (row.type) {
    case 'stage':
      return stageEntry(row, at);
    case 'decision':
      return decisionEntry(row, at);
    case 'payment':
      return paymentEntry(row, at);
    default:
      return null;
  }
}

/**
 * The timeline in client words, newest first. Two stage entries next to each
 * other that read as the SAME client stage (two machine states share one word,
 * or a move out and back) collapse to the newer one: the client would otherwise
 * read the same line twice.
 */
export function parseTimeline(raw: unknown): PortalTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: PortalTimelineEntry[] = [];
  for (const candidate of raw.slice(0, TIMELINE_MAX_ENTRIES)) {
    const entry = timelineEntry(candidate);
    if (entry === null) continue;
    const previous = entries[entries.length - 1];
    const repeatsStage =
      entry.type === 'stage' && previous?.type === 'stage' && previous.stageKey === entry.stageKey;
    if (!repeatsStage) entries.push(entry);
  }
  return entries;
}

/** When the design was delivered (or construction began): the newest such stage entry. */
export function deliveredAt(timeline: readonly PortalTimelineEntry[]): string | null {
  const entry = timeline.find(
    (candidate) => candidate.type === 'stage' && (candidate.stageKey === 'delivered' || candidate.stageKey === 'construction'),
  );
  return entry?.at ?? null;
}
