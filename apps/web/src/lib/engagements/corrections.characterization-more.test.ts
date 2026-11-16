// MORE CHARACTERIZATION of recordEventCorrectionCore, beside the file committed before the
// split (which is not edited): every terminal state it refuses,
// every live state it reads on in, and the kind the audit says was superseded.
// Same recording double and conventions; written against the split code.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createRecordingTx } from '@/test/recording-tx';

vi.mock('server-only', () => ({}));
const db = createRecordingTx();
const entitlement = { enabled: true };
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    db.journal.push('begin');
    try {
      return await fn(db.tx);
    } finally {
      db.journal.push('end');
    }
  },
}));
vi.mock('@/lib/entitlements/entitlements', () => ({
  loadWorkspaceEntitlements: async () => ({}),
  canUseFlow: () => entitlement.enabled,
}));
vi.mock('@/lib/audit', () => ({
  recordAudit: async (_tx: unknown, entry: unknown) => {
    db.journal.push('audit ' + db.render(entry));
  },
}));

const { recordEventCorrectionCore } = await import('./corrections');
const { DESIGN_STATES, TERMINAL_STATES } = await import('./states');

// Every state, written out: a predicate that names only one terminal state, or
// that refuses a live one, fails on the state it got wrong. The two lists are
// checked against states.ts, so a state added there has to be placed here.
const TERMINAL = ['closed_design_only', 'execution', 'abandoned'];
const LIVE = [
  'created',
  'design_proposal',
  'survey',
  'layout',
  'concept_review',
  'negotiation',
  'design_3d',
  'final_approval',
  'shop_drawings',
  'boq',
  'execution_decision',
  'design_only_handoff',
  'change_triage',
];

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

// The statements, exactly as the core issues them.
const READ_ENGAGEMENT =
  'select({id: design_engagements.id, state: design_engagements.state}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const READ_TARGET_EVENT =
  'select({id: engagement_events.id, kind: engagement_events.kind}).from(table:engagement_events).where(sql(("engagement_events"."id" = $1 and "engagement_events"."engagement_id" = $2) ["33333333-3333-4333-8333-333333333333","11111111-1111-4111-8111-111111111111"])).limit(1)';
const READ_EXISTING_CORRECTION =
  'select({id: engagement_events.id}).from(table:engagement_events).where(sql("engagement_events"."supersedes_event_id" = $1 ["33333333-3333-4333-8333-333333333333"])).limit(1)';
const APPEND_CORRECTION =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "event_correction", actorUserId: "u-1", supersedesEventId: "33333333-3333-4333-8333-333333333333", note: "Wrong delivery"}).returning({id: engagement_events.id})';
const AUDIT_SUPERSEDED_HANDOFF =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "update", before: null, after: {event_id: "ev-9", kind: "event_correction", supersedes_event_id: "33333333-3333-4333-8333-333333333333", supersedes_kind: "handoff_acknowledgement", reason: "Wrong delivery"}}';
const AUDIT_SUPERSEDED_CONCEPT_APPROVAL =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "update", before: null, after: {event_id: "ev-9", kind: "event_correction", supersedes_event_id: "33333333-3333-4333-8333-333333333333", supersedes_kind: "concept_approval", reason: "Wrong delivery"}}';

const retraction = { engagementId: ENGAGEMENT_ID, eventId: EVENT_ID, reason: 'Wrong delivery' };
const liveEngagement = [{ id: ENGAGEMENT_ID, state: 'created' }];

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };

let log: ReturnType<typeof vi.spyOn>;

/** The journal, that every scripted result was consumed, and how many lines were logged. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
});
beforeEach(() => {
  db.reset();
  entitlement.enabled = true;
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => log.mockRestore());
afterAll(() => vi.useRealTimers());

describe('the state lists this file scripts', () => {
  it('are exactly the terminal and the live states of states.ts', () => {
    expect([...TERMINAL].sort()).toEqual([...TERMINAL_STATES].sort());
    expect([...LIVE, ...TERMINAL].sort()).toEqual([...DESIGN_STATES].sort());
    expectTrace([], 0);
  });
});

describe('recordEventCorrectionCore, every state of the engagement', () => {
  it.each(TERMINAL)('refuses a retraction on an engagement in %s: engagement_not_active, the event never read', async (state) => {
    db.respond([{ id: ENGAGEMENT_ID, state }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it.each(LIVE)('lets a retraction on an engagement in %s through to the event read', async (state) => {
    db.respond([{ id: ENGAGEMENT_ID, state }], []);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'event_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, 'end'], 0);
  });
});

describe('recordEventCorrectionCore, the kind the audit says was superseded', () => {
  it('is the kind of the event that was READ: a handover acknowledgement', async () => {
    db.respond(liveEngagement, [{ id: EVENT_ID, kind: 'handoff_acknowledgement' }], [], [{ id: 'ev-9' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: true, data: 'ev-9' });
    expectTrace(
      ['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, READ_EXISTING_CORRECTION, APPEND_CORRECTION, AUDIT_SUPERSEDED_HANDOFF, 'end'],
      0,
    );
  });

  it('is the kind of the event that was READ: a concept approval', async () => {
    db.respond(liveEngagement, [{ id: EVENT_ID, kind: 'concept_approval' }], [], [{ id: 'ev-9' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: true, data: 'ev-9' });
    expectTrace(
      ['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, READ_EXISTING_CORRECTION, APPEND_CORRECTION, AUDIT_SUPERSEDED_CONCEPT_APPROVAL, 'end'],
      0,
    );
  });
});
