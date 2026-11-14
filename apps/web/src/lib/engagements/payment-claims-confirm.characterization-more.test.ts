// MORE CHARACTERIZATION of confirmPaymentClaimCore, beside the file committed before the
// split (which is not edited): every terminal state, a milestone kind other
// than deposit, and a raced payment whose amount is written at another scale.
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

const { confirmPaymentClaimCore } = await import('./payment-claims');
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

// The statements, exactly as the core issues them.
const LOCK_CLAIM =
  'select({id: client_payment_claims.id, engagementId: client_payment_claims.engagement_id, milestoneKind: client_payment_claims.milestone_kind, status: client_payment_claims.status, confirmedPaymentEventId: client_payment_claims.confirmed_payment_event_id}).from(table:client_payment_claims).where(sql("client_payment_claims"."id" = $1 ["claim-1"])).for("update").limit(1)';
const LOCK_ENGAGEMENT =
  'select({state: design_engagements.state, designFee: design_engagements.design_fee}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["eng-1"])).for("update")';
const READ_DEPOSIT_MILESTONE =
  'select({basis: engagement_milestones.basis, value: engagement_milestones.value}).from(table:engagement_milestones).where(sql(("engagement_milestones"."engagement_id" = $1 and "engagement_milestones"."kind" = $2) ["eng-1","deposit"])).limit(1)';
const READ_DEPOSIT_PAID =
  'select({amount: payment_events.amount}).from(table:payment_events).where(sql(("payment_events"."engagement_id" = $1 and "payment_events"."kind" = $2) ["eng-1","deposit"]))';
const INSERT_DEPOSIT_PAYMENT =
  'insert(table:payment_events).values({orgId: "o-1", engagementId: "eng-1", kind: "deposit", amount: "30000.0000", recordedBy: "u-1", idempotencyKey: "claim:claim-1"}).onConflictDoNothing({target: [payment_events.org_id, payment_events.engagement_id, payment_events.idempotency_key], where: sql(idempotency_key is not null [])}).returning({id: payment_events.id})';
const READ_BALANCE_MILESTONE =
  'select({basis: engagement_milestones.basis, value: engagement_milestones.value}).from(table:engagement_milestones).where(sql(("engagement_milestones"."engagement_id" = $1 and "engagement_milestones"."kind" = $2) ["eng-1","balance"])).limit(1)';
const READ_BALANCE_PAID =
  'select({amount: payment_events.amount}).from(table:payment_events).where(sql(("payment_events"."engagement_id" = $1 and "payment_events"."kind" = $2) ["eng-1","balance"]))';
const INSERT_BALANCE_PAYMENT =
  'insert(table:payment_events).values({orgId: "o-1", engagementId: "eng-1", kind: "balance", amount: "30000.0000", recordedBy: "u-1", idempotencyKey: "claim:claim-1"}).onConflictDoNothing({target: [payment_events.org_id, payment_events.engagement_id, payment_events.idempotency_key], where: sql(idempotency_key is not null [])}).returning({id: payment_events.id})';
const AUDIT_BALANCE_PAYMENT =
  'audit {entity: "design_engagement", entityId: "eng-1", action: "create", before: null, after: {payment_id: "pay-1", kind: "balance", amount: "30000.0000", claim_id: "claim-1"}}';
const READ_RACED_PAYMENT =
  'select({id: payment_events.id, kind: payment_events.kind, amount: payment_events.amount}).from(table:payment_events).where(sql(("payment_events"."org_id" = $1 and "payment_events"."engagement_id" = $2 and "payment_events"."idempotency_key" = $3) ["o-1","eng-1","claim:claim-1"])).limit(1)';
const FLIP_CLAIM_TO_PAY_1 =
  'update(table:client_payment_claims).set({status: "confirmed", confirmedPaymentEventId: "pay-1", resolvedBy: "u-1", resolvedAt: Date(2026-11-14T10:00:00.000Z), updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql(("client_payment_claims"."id" = $1 and "client_payment_claims"."status" = $2) ["claim-1","pending"])).returning({id: client_payment_claims.id})';
const FLIP_CLAIM_TO_PAY_7 =
  'update(table:client_payment_claims).set({status: "confirmed", confirmedPaymentEventId: "pay-7", resolvedBy: "u-1", resolvedAt: Date(2026-11-14T10:00:00.000Z), updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql(("client_payment_claims"."id" = $1 and "client_payment_claims"."status" = $2) ["claim-1","pending"])).returning({id: client_payment_claims.id})';

const pendingClaim = { id: 'claim-1', engagementId: 'eng-1', milestoneKind: 'deposit', status: 'pending', confirmedPaymentEventId: null };
const amountMilestone = { basis: 'amount', value: '30000.0000' };
const engagementIn = (state: string) => ({ state, designFee: '100000.0000' });

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

const confirm = (amount: string) => confirmPaymentClaimCore(owner, { claimId: 'claim-1', amount });

describe('the state lists this file scripts', () => {
  it('are exactly the terminal and the live states of states.ts', () => {
    expect([...TERMINAL].sort()).toEqual([...TERMINAL_STATES].sort());
    expect([...LIVE, ...TERMINAL].sort()).toEqual([...DESIGN_STATES].sort());
    expectTrace([], 0);
  });
});

describe('confirmPaymentClaimCore, every state of the engagement', () => {
  it.each(TERMINAL)('refuses a claim on an engagement in %s: engagement_not_active, the milestone never read', async (state) => {
    db.respond([pendingClaim], [engagementIn(state)]);
    expect(await confirm('30000')).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, 'end'], 0);
  });

  it.each(LIVE)('lets a claim on an engagement in %s through to the milestone read', async (state) => {
    db.respond([pendingClaim], [engagementIn(state)], []);
    expect(await confirm('30000')).toEqual({ ok: false, error: 'claim_already_settled' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_DEPOSIT_MILESTONE, 'end'], 0);
  });
});

describe('confirmPaymentClaimCore, the milestone the claim is for', () => {
  it('a BALANCE claim reads the balance milestone and its payments, and records a balance payment', async () => {
    db.respond(
      [{ ...pendingClaim, milestoneKind: 'balance' }],
      [engagementIn('created')],
      [amountMilestone],
      [],
      [{ id: 'pay-1' }],
      [{ id: 'claim-1' }],
    );
    expect(await confirm('30000')).toEqual({ ok: true, data: 'pay-1', already: false });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_BALANCE_MILESTONE, READ_BALANCE_PAID, INSERT_BALANCE_PAYMENT, AUDIT_BALANCE_PAYMENT, FLIP_CLAIM_TO_PAY_1, 'end'],
      0,
    );
  });

  it('a balance milestone already paid in full refuses the balance claim', async () => {
    db.respond([{ ...pendingClaim, milestoneKind: 'balance' }], [engagementIn('created')], [amountMilestone], [{ amount: '30000.0000' }]);
    expect(await confirm('30000')).toEqual({ ok: false, error: 'claim_already_settled' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_BALANCE_MILESTONE, READ_BALANCE_PAID, 'end'], 0);
  });
});

describe('confirmPaymentClaimCore, a raced payment whose amount is written at another scale', () => {
  // The amounts are compared as MONEY (scale-4 BigInt), never as text: a row
  // read back as "30000" or "30000.00" is the same money as the confirmed
  // "30000.0000", so it is adopted, exactly like a row written "30000.0000".
  it.each(['30000', '30000.0', '30000.00'])('adopts a raced row whose amount reads %s for a confirmed 30000.0000', async (stored) => {
    db.respond(
      [pendingClaim],
      [engagementIn('created')],
      [amountMilestone],
      [],
      [],
      [{ id: 'pay-7', kind: 'deposit', amount: stored }],
      [{ id: 'claim-1' }],
    );
    expect(await confirm('30000')).toEqual({ ok: true, data: 'pay-7', already: true });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_DEPOSIT_MILESTONE, READ_DEPOSIT_PAID, INSERT_DEPOSIT_PAYMENT, READ_RACED_PAYMENT, FLIP_CLAIM_TO_PAY_7, 'end'],
      0,
    );
  });
});
