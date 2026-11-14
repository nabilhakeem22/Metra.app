// CHARACTERIZATION of recordRomAcknowledgementCore: what it answers and, statement
// by statement, what it asks the database on every branch. Written against the
// code as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; the provenance rules run for real, with the clock held at
// 2026-11-14T10:00Z. What a real Postgres adds (the append-only grants, RLS,
// clock_timestamp ordering) is proven in tests/actions/engagements-rom-ack.dbtest.ts.
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

const { recordRomAcknowledgementCore } = await import('./rom-acknowledgement');

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';

// The statements, exactly as the unsplit core issued them.
const READ_ENGAGEMENT =
  'select({id: design_engagements.id, state: design_engagements.state, romLow: design_engagements.rom_low, romHigh: design_engagements.rom_high, romIssuedAt: design_engagements.rom_issued_at}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const APPEND_EVIDENCED_ACKNOWLEDGEMENT =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "rom_acknowledgement", actorUserId: "u-1", rangeLow: "100000.0000", rangeHigh: "150000.0000", acknowledgedIssueAt: Date(2026-11-10T08:00:00.000Z), note: "agreed", occurredOn: "2026-11-13", evidence: "phone", decidedAt: sql(clock_timestamp() [])}).returning({id: engagement_events.id})';
const AUDIT_EVIDENCED_ACKNOWLEDGEMENT =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {event_id: "ev-1", kind: "rom_acknowledgement", range_low: "100000.0000", range_high: "150000.0000", occurred_on: "2026-11-13", evidence: "phone"}}';
const APPEND_BARE_ACKNOWLEDGEMENT =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "rom_acknowledgement", actorUserId: "u-1", rangeLow: "100000.0000", rangeHigh: "150000.0000", acknowledgedIssueAt: Date(2026-11-10T08:00:00.000Z), note: null, occurredOn: null, evidence: null, decidedAt: sql(clock_timestamp() [])}).returning({id: engagement_events.id})';
const AUDIT_BARE_ACKNOWLEDGEMENT =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {event_id: "ev-1", kind: "rom_acknowledgement", range_low: "100000.0000", range_high: "150000.0000", occurred_on: null, evidence: null}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };

const bare = { engagementId: ENGAGEMENT_ID };
const issuedEngagement = {
  id: ENGAGEMENT_ID,
  state: 'created',
  romLow: '100000.0000',
  romHigh: '150000.0000',
  romIssuedAt: new Date('2026-11-10T08:00:00Z'),
};

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

describe('recordRomAcknowledgementCore, before a transaction opens', () => {
  it('K1 a day after today (UTC) is refused under occurredOn, opening nothing', async () => {
    expect(await recordRomAcknowledgementCore(owner, { ...bare, occurredOn: '2026-11-15' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { occurredOn: { code: 'date_in_future' } },
    });
    expectTrace([], 0);
  });

  it('K1 the fields are read BEFORE the capability: a viewer with a future day hears about the day', async () => {
    expect(await recordRomAcknowledgementCore(viewer, { ...bare, occurredOn: '2026-11-15' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { occurredOn: { code: 'date_in_future' } },
    });
    expectTrace([], 0);
  });

  it('K1 today itself (UTC) passes the day rule and reaches the engagement read', async () => {
    db.respond([]);
    expect(await recordRomAcknowledgementCore(owner, { ...bare, occurredOn: '2026-11-14' })).toEqual({
      ok: false,
      error: 'engagement_not_found',
    });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('a viewer is forbidden, opening nothing', async () => {
    expect(await recordRomAcknowledgementCore(viewer, bare)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('a workspace without the flow is refused inside the transaction, before any statement', async () => {
    entitlement.enabled = false;
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });
});

describe('recordRomAcknowledgementCore, the order of its refusals', () => {
  it('K2 an engagement that does not resolve is engagement_not_found', async () => {
    db.respond([]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'engagement_not_found' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('K3 an abandoned engagement with its band set and issued is engagement_not_active', async () => {
    db.respond([{ ...issuedEngagement, state: 'abandoned' }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('K4 terminal outranks not-set: an abandoned engagement with no band is engagement_not_active', async () => {
    db.respond([{ ...issuedEngagement, state: 'abandoned', romLow: null }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('K5 not-set outranks not-issued: no low and never issued is rom_not_set', async () => {
    db.respond([{ ...issuedEngagement, romLow: null, romIssuedAt: null }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'rom_not_set' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('K5 a band with no high is rom_not_set as well', async () => {
    db.respond([{ ...issuedEngagement, romHigh: null }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'rom_not_set' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it('K6 a band that was set but never issued is rom_not_issued, nothing appended', async () => {
    db.respond([{ ...issuedEngagement, romIssuedAt: null }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: false, error: 'rom_not_issued' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });
});

describe('recordRomAcknowledgementCore, the ledger row and its audit', () => {
  it('K7 appends the band and the issuance it READ, the typed provenance trimmed, then the audit', async () => {
    db.respond([issuedEngagement], [{ id: 'ev-1' }]);
    const input = { ...bare, evidence: 'phone', occurredOn: '2026-11-13', note: '  agreed  ' };
    expect(await recordRomAcknowledgementCore(owner, input)).toEqual({ ok: true, data: 'ev-1' });
    expectTrace(['begin', READ_ENGAGEMENT, APPEND_EVIDENCED_ACKNOWLEDGEMENT, AUDIT_EVIDENCED_ACKNOWLEDGEMENT, 'end'], 0);
  });

  it('K7 with nothing typed, the note, the day and the evidence are stored as null', async () => {
    db.respond([issuedEngagement], [{ id: 'ev-1' }]);
    expect(await recordRomAcknowledgementCore(owner, bare)).toEqual({ ok: true, data: 'ev-1' });
    expectTrace(['begin', READ_ENGAGEMENT, APPEND_BARE_ACKNOWLEDGEMENT, AUDIT_BARE_ACKNOWLEDGEMENT, 'end'], 0);
  });
});
