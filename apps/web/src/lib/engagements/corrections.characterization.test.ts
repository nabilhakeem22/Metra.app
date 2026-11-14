// CHARACTERIZATION of recordEventCorrectionCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; the reason rule runs for real. The database suites
// (consequence-handover.dbtest.ts, delivery-rom-studio-ack.dbtest.ts) cover the
// happy path only, so every refusal below is pinned here and nowhere else.
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

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

// The statements, exactly as the unsplit core issued them.
const READ_ENGAGEMENT =
  'select({id: design_engagements.id, state: design_engagements.state}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const READ_TARGET_EVENT =
  'select({id: engagement_events.id, kind: engagement_events.kind}).from(table:engagement_events).where(sql(("engagement_events"."id" = $1 and "engagement_events"."engagement_id" = $2) ["33333333-3333-4333-8333-333333333333","11111111-1111-4111-8111-111111111111"])).limit(1)';
const READ_EXISTING_CORRECTION =
  'select({id: engagement_events.id}).from(table:engagement_events).where(sql("engagement_events"."supersedes_event_id" = $1 ["33333333-3333-4333-8333-333333333333"])).limit(1)';
const APPEND_CORRECTION =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "event_correction", actorUserId: "u-1", supersedesEventId: "33333333-3333-4333-8333-333333333333", note: "Wrong delivery"}).returning({id: engagement_events.id})';
const AUDIT_CORRECTION =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "update", before: null, after: {event_id: "ev-9", kind: "event_correction", supersedes_event_id: "33333333-3333-4333-8333-333333333333", supersedes_kind: "rom_acknowledgement", reason: "Wrong delivery"}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const projectManager: OrgContext = { ...owner, role: 'project_manager' };

const retraction = { engagementId: ENGAGEMENT_ID, eventId: EVENT_ID, reason: '  Wrong delivery  ' };
const liveEngagement = [{ id: ENGAGEMENT_ID, state: 'created' }];
const acknowledgement = [{ id: EVENT_ID, kind: 'rom_acknowledgement' }];

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

describe('recordEventCorrectionCore, before a transaction opens', () => {
  it('C1 an engagement id that is no id is malformed', async () => {
    expect(await recordEventCorrectionCore(owner, { ...retraction, engagementId: 'x' })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('C2 an event id that is no id is malformed', async () => {
    expect(await recordEventCorrectionCore(owner, { ...retraction, eventId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('C3 a blank reason is refused under reason', async () => {
    expect(await recordEventCorrectionCore(owner, { ...retraction, reason: '   ' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { reason: { code: 'required' } },
    });
    expectTrace([], 0);
  });

  it('C4 the ids are checked BEFORE the reason: a bad id with a blank reason is malformed', async () => {
    expect(await recordEventCorrectionCore(owner, { ...retraction, eventId: 'x', reason: '   ' })).toEqual({
      ok: false,
      error: 'malformed',
    });
    expectTrace([], 0);
  });

  it('C5 a project manager may not retract: forbidden, opening nothing', async () => {
    expect(await recordEventCorrectionCore(projectManager, retraction)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('C5 the reason is checked BEFORE the capability: a project manager with a blank reason hears about the reason', async () => {
    expect(await recordEventCorrectionCore(projectManager, { ...retraction, reason: ' ' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { reason: { code: 'required' } },
    });
    expectTrace([], 0);
  });

  it('a workspace without the flow is refused inside the transaction, before any statement', async () => {
    entitlement.enabled = false;
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });
});

describe('recordEventCorrectionCore, the order of its refusals', () => {
  it('C6 an engagement that does not resolve is engagement_not_found', async () => {
    db.respond([]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'engagement_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('C7 a terminal engagement is engagement_not_active, before the event is read', async () => {
    db.respond([{ id: ENGAGEMENT_ID, state: 'abandoned' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('C8 an event that is not on THIS engagement is event_not_found', async () => {
    db.respond(liveEngagement, []);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'event_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, 'end'], 0);
  });

  it('C9 a correction cannot be retracted: malformed, before the already-corrected read', async () => {
    db.respond(liveEngagement, [{ id: EVENT_ID, kind: 'event_correction' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'malformed' });
    expectTrace(['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, 'end'], 0);
  });

  it('C10 an event already retracted is already_corrected, nothing appended', async () => {
    db.respond(liveEngagement, acknowledgement, [{ id: 'ev-8' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: false, error: 'already_corrected' });
    expectTrace(['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, READ_EXISTING_CORRECTION, 'end'], 0);
  });
});

describe('recordEventCorrectionCore, the correction row and its audit', () => {
  it('C11 appends the correction with the TRIMMED reason; the audit carries the kind it superseded', async () => {
    db.respond(liveEngagement, acknowledgement, [], [{ id: 'ev-9' }]);
    expect(await recordEventCorrectionCore(owner, retraction)).toEqual({ ok: true, data: 'ev-9' });
    expectTrace(
      ['begin', READ_ENGAGEMENT, READ_TARGET_EVENT, READ_EXISTING_CORRECTION, APPEND_CORRECTION, AUDIT_CORRECTION, 'end'],
      0,
    );
  });
});
