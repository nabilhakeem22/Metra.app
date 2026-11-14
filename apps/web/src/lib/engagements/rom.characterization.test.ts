// CHARACTERIZATION of setEngagementRomCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code or the audit row fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; the band rules run for real. What a real Postgres adds (the
// admission predicate against a racing abandon, the CHECK, clock_timestamp
// ordering, the column grants) is proven in tests/actions/engagements-rom.dbtest.ts.
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

const { setEngagementRomCore } = await import('./rom');

const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';

// The statements, exactly as the unsplit core issued them.
const ADMIT_BAND =
  'update(table:design_engagements).set({romLow: "100000.0000", romHigh: "150000.0000", romIssuedAt: null, updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql(("design_engagements"."id" = $1 and "design_engagements"."state" not in ($2, $3, $4)) ["11111111-1111-4111-8111-111111111111","closed_design_only","execution","abandoned"])).returning({id: design_engagements.id})';
const READ_WHY_NOT_ADMITTED =
  'select({id: design_engagements.id}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const APPEND_BAND_EVENT =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "rom_range_set", actorUserId: "u-1", rangeLow: "100000.0000", rangeHigh: "150000.0000", decidedAt: sql(clock_timestamp() [])}).returning({id: engagement_events.id})';
const AUDIT_WITH_EVENT =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "update", before: null, after: {rom_low: "100000.0000", rom_high: "150000.0000", event_id: "ev-1"}}';
const AUDIT_WITHOUT_EVENT =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "update", before: null, after: {rom_low: "100000.0000", rom_high: "150000.0000", event_id: null}}';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };

const band = { engagementId: ENGAGEMENT_ID, romLow: '100000', romHigh: '150000' };
const highBelowLow = { engagementId: ENGAGEMENT_ID, romLow: '150000', romHigh: '100000' };

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

describe('setEngagementRomCore, the order of its refusals', () => {
  it('R1 an id that is no id is malformed, opening nothing', async () => {
    expect(await setEngagementRomCore(owner, { ...band, engagementId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('R1 the id shape is checked BEFORE the capability: a viewer with a bad id hears malformed', async () => {
    expect(await setEngagementRomCore(viewer, { ...band, engagementId: 'x' })).toEqual({ ok: false, error: 'malformed' });
    expectTrace([], 0);
  });

  it('R2 the capability is checked BEFORE the band: a viewer with a bad band is forbidden', async () => {
    expect(await setEngagementRomCore(viewer, highBelowLow)).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });

  it('R3 the flow is checked BEFORE the band: a workspace without it hears flow_not_enabled', async () => {
    entitlement.enabled = false;
    expect(await setEngagementRomCore(owner, highBelowLow)).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });

  it('R4 a high below the low is refused under romHigh INSIDE the transaction, before any statement', async () => {
    expect(await setEngagementRomCore(owner, highBelowLow)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { romHigh: { code: 'rom_range_invalid' } },
    });
    expectTrace(['begin', 'end'], 0);
  });
});

describe('setEngagementRomCore, the admission gate', () => {
  it('R5 nothing admitted and the row exists: engagement_not_active, no event', async () => {
    db.respond([], [{ id: ENGAGEMENT_ID }]);
    expect(await setEngagementRomCore(owner, band)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', ADMIT_BAND, READ_WHY_NOT_ADMITTED, 'end'], 0);
  });

  it('R6 nothing admitted and no row: engagement_not_found, no event', async () => {
    db.respond([], []);
    expect(await setEngagementRomCore(owner, band)).toEqual({ ok: false, error: 'engagement_not_found' });
    expectTrace(['begin', ADMIT_BAND, READ_WHY_NOT_ADMITTED, 'end'], 0);
  });
});

describe('setEngagementRomCore, the ledger row and its audit', () => {
  it('R7 admitted: one update, one event, the audit carrying the event id', async () => {
    db.respond([{ id: ENGAGEMENT_ID }], [{ id: 'ev-1' }]);
    expect(await setEngagementRomCore(owner, band)).toStrictEqual({ ok: true, data: undefined });
    expectTrace(['begin', ADMIT_BAND, APPEND_BAND_EVENT, AUDIT_WITH_EVENT, 'end'], 0);
  });

  it('R8 an insert that returns no row still answers ok, with event_id null in the audit', async () => {
    db.respond([{ id: ENGAGEMENT_ID }], []);
    expect(await setEngagementRomCore(owner, band)).toStrictEqual({ ok: true, data: undefined });
    expectTrace(['begin', ADMIT_BAND, APPEND_BAND_EVENT, AUDIT_WITHOUT_EVENT, 'end'], 0);
  });
});
