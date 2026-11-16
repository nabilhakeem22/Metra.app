// MORE CHARACTERIZATION of recordArtifactCore, beside the file committed before the
// split (which is not edited): every terminal state it refuses and every
// live state it records against.
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

const { recordArtifactCore } = await import('./artifacts');
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
  'select({id: design_engagements.id, state: design_engagements.state}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["11111111-1111-4111-8111-111111111111"])).limit(1)';
const INSERT_BARE_SURVEY =
  'insert(table:engagement_artifacts).values({orgId: "o-1", engagementId: "11111111-1111-4111-8111-111111111111", kind: "survey", fileId: null, contentHash: null, label: null, attestedBy: "u-1", note: null}).returning({id: engagement_artifacts.id})';
const AUDIT_SURVEY =
  'audit {entity: "design_engagement", entityId: "11111111-1111-4111-8111-111111111111", action: "create", before: null, after: {artifact_id: "art-1", kind: "survey"}}';

const survey = { engagementId: ENGAGEMENT_ID, kind: 'survey' as const };

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

describe('recordArtifactCore, every state of the engagement', () => {
  it.each(TERMINAL)('refuses a record against an engagement in %s: engagement_not_active, nothing inserted', async (state) => {
    db.respond([{ id: ENGAGEMENT_ID, state }]);
    expect(await recordArtifactCore(owner, survey)).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', READ_ENGAGEMENT, 'end'], 0);
  });

  it.each(LIVE)('records against an engagement in %s', async (state) => {
    db.respond([{ id: ENGAGEMENT_ID, state }], [{ id: 'art-1' }]);
    expect(await recordArtifactCore(owner, survey)).toEqual({ ok: true, data: 'art-1' });
    expectTrace(['begin', READ_ENGAGEMENT, INSERT_BARE_SURVEY, AUDIT_SURVEY, 'end'], 0);
  });
});
