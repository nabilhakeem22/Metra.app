// MORE CHARACTERIZATION of recordRomAcknowledgementCore, beside the file committed before the
// split (which is not edited): every terminal state it refuses
// and every live state it appends against.
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

const { recordRomAcknowledgementCore } = await import('./rom-acknowledgement');
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

// The statements, exactly as the core issues them.
const READ_ENGAGEMENT =
  'select({id: design_engagements.id, state: design_engagements.state, romLow: design_engagements.rom_low, romHigh: design_engagements.rom_high, romIssuedAt: design_engagements.rom_issued_at}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const APPEND_BARE_ACKNOWLEDGEMENT =
  'insert(table:engagement_events).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "rom_acknowledgement", actorUserId: "u-1", rangeLow: "100000.0000", rangeHigh: "150000.0000", acknowledgedIssueAt: Date(2026-11-10T08:00:00.000Z), note: null, occurredOn: null, evidence: null, decidedAt: sql(clock_timestamp() [])}).returning({id: engagement_events.id})';
const AUDIT_BARE_ACKNOWLEDGEMENT =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {event_id: "ev-1", kind: "rom_acknowledgement", range_low: "100000.0000", range_high: "150000.0000", occurred_on: null, evidence: null}}';

const issuedEngagementIn = (state: string) => ({
  id: ENGAGEMENT_ID,
  state,
  romLow: '100000.0000',
  romHigh: '150000.0000',
  romIssuedAt: new Date('2026-11-10T08:00:00Z'),
});

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

const acknowledge = () => recordRomAcknowledgementCore(owner, { engagementId: ENGAGEMENT_ID });

describe('the state lists this file scripts', () => {
  it('are exactly the terminal and the live states of states.ts', () => {
    expect([...TERMINAL].sort()).toEqual([...TERMINAL_STATES].sort());
    expect([...LIVE, ...TERMINAL].sort()).toEqual([...DESIGN_STATES].sort());
    expectTrace([], 0);
  });
});

describe('recordRomAcknowledgementCore, every state of the engagement', () => {
  it.each(TERMINAL)('refuses an acknowledgement on an engagement in %s: engagement_not_active, nothing appended', async (state) => {
    db.respond([issuedEngagementIn(state)]);
    expect(await acknowledge()).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it.each(LIVE)('appends an acknowledgement on an engagement in %s', async (state) => {
    db.respond([issuedEngagementIn(state)], [{ id: 'ev-1' }]);
    expect(await acknowledge()).toEqual({ ok: true, data: 'ev-1' });
    expectTrace(['begin', READ_ENGAGEMENT, APPEND_BARE_ACKNOWLEDGEMENT, AUDIT_BARE_ACKNOWLEDGEMENT, 'end'], 0);
  });
});
