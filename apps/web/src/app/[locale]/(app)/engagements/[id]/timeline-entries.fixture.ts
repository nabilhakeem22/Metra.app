// Records and catalogue stand-ins for the timeline tests. Test support only.
import type {
  EngagementClientActivityRecord,
  EngagementEventRecord,
  EngagementTransitionRecord,
} from '@/lib/engagements/queries';
import { buildTimelineEntries } from './timeline-entries';
import type { TimelineLabels } from './timeline-labels';

export const LABELS: TimelineLabels = {
  transition: (from, to) => (from && to ? `${from}->${to}` : `state:${to ?? 'created'}`),
  eventKind: (kind) => `kind:${kind}`,
  clientActivity: (kind, actorName) =>
    actorName ? `kind:${kind} by ${actorName}` : `kind:${kind}`,
  offlineChannel: (channel) => `channel:${channel}`,
  byMetra: (move) => `${move} by Metra`,
  closedOnClientConfirmation: () => 'closed on confirmation',
};

export function transition(
  overrides: Partial<EngagementTransitionRecord> = {},
): EngagementTransitionRecord {
  return {
    id: 'tr-1',
    trigger: 'submitDesignFee',
    fromState: 'created',
    toState: 'design_proposal',
    actorUserId: 'user-1',
    note: null,
    decidedAt: new Date('2026-06-01T10:00:00.000Z'),
    ...overrides,
  } as EngagementTransitionRecord;
}

export function event(overrides: Partial<EngagementEventRecord> = {}): EngagementEventRecord {
  return {
    id: 'ev-1',
    kind: 'rom_acknowledgement',
    actorUserId: 'user-1',
    actorChannel: 'staff',
    occurredOn: null,
    evidence: null,
    note: null,
    supersedesEventId: null,
    decidedAt: new Date('2026-06-02T10:00:00.000Z'),
    ...overrides,
  } as EngagementEventRecord;
}

export function clientActivity(
  overrides: Partial<EngagementClientActivityRecord> = {},
): EngagementClientActivityRecord {
  return {
    kind: 'rom_acknowledgement',
    actorName: 'Mona',
    note: null,
    rangeLow: null,
    rangeHigh: null,
    decidedAt: new Date('2026-06-03T10:00:00.000Z'),
    ...overrides,
  } as EngagementClientActivityRecord;
}

const EMPTY: {
  transitions: EngagementTransitionRecord[];
  events: EngagementEventRecord[];
  clientActivity: EngagementClientActivityRecord[];
} = { transitions: [], events: [], clientActivity: [] };
export const build = (input: Partial<typeof EMPTY>) =>
  buildTimelineEntries({ ...EMPTY, ...input }, LABELS);
