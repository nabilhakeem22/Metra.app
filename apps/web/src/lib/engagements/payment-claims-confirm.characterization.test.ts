// CHARACTERIZATION of confirmPaymentClaimCore: what it answers and, statement by
// statement, what it asks the database on every branch. Written against the code
// as it stood BEFORE it was split into named phases, and not edited since: a
// refactor that changes a statement, its parameters, the order, an early return,
// a thrown code, the audit row or the `already` flag fails here.
//
// The transaction is a recording double (src/test/recording-tx.ts) under the REAL
// mutateInOrg; milestone-settlement and the field rules run for real. What a real
// Postgres adds (the row locks, RLS, the partial unique index) is proven in
// tests/actions/delivery-payment-claim.dbtest.ts.
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

// The statements, exactly as the unsplit core issued them.
const LOCK_CLAIM =
  'select({id: client_payment_claims.id, engagementId: client_payment_claims.engagement_id, milestoneKind: client_payment_claims.milestone_kind, status: client_payment_claims.status, confirmedPaymentEventId: client_payment_claims.confirmed_payment_event_id}).from(table:client_payment_claims).where(sql("client_payment_claims"."id" = $1 ["claim-1"])).for("update").limit(1)';
const LOCK_ENGAGEMENT =
  'select({state: design_engagements.state, designFee: design_engagements.design_fee}).from(table:design_engagements).where(sql("design_engagements"."id" = $1 ["eng-1"])).for("update")';
const READ_MILESTONE =
  'select({basis: engagement_milestones.basis, value: engagement_milestones.value}).from(table:engagement_milestones).where(sql(("engagement_milestones"."engagement_id" = $1 and "engagement_milestones"."kind" = $2) ["eng-1","deposit"])).limit(1)';
const READ_PAID =
  'select({amount: payment_events.amount}).from(table:payment_events).where(sql(("payment_events"."engagement_id" = $1 and "payment_events"."kind" = $2) ["eng-1","deposit"]))';
const INSERT_PAYMENT =
  'insert(table:payment_events).values({orgId: "o-1", engagementId: "eng-1", kind: "deposit", amount: "30000.0000", recordedBy: "u-1", idempotencyKey: "claim:claim-1"}).onConflictDoNothing({target: [payment_events.org_id, payment_events.engagement_id, payment_events.idempotency_key], where: sql(idempotency_key is not null [])}).returning({id: payment_events.id})';
const AUDIT_PAYMENT =
  'audit {entity: "design_engagement", entityId: "eng-1", action: "create", before: null, after: {payment_id: "pay-1", kind: "deposit", amount: "30000.0000", claim_id: "claim-1"}}';
const READ_RACED_PAYMENT =
  'select({id: payment_events.id, kind: payment_events.kind, amount: payment_events.amount}).from(table:payment_events).where(sql(("payment_events"."org_id" = $1 and "payment_events"."engagement_id" = $2 and "payment_events"."idempotency_key" = $3) ["o-1","eng-1","claim:claim-1"])).limit(1)';
const FLIP_CLAIM_TO_PAY_1 =
  'update(table:client_payment_claims).set({status: "confirmed", confirmedPaymentEventId: "pay-1", resolvedBy: "u-1", resolvedAt: Date(2026-11-14T10:00:00.000Z), updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql(("client_payment_claims"."id" = $1 and "client_payment_claims"."status" = $2) ["claim-1","pending"])).returning({id: client_payment_claims.id})';
const FLIP_CLAIM_TO_PAY_7 =
  'update(table:client_payment_claims).set({status: "confirmed", confirmedPaymentEventId: "pay-7", resolvedBy: "u-1", resolvedAt: Date(2026-11-14T10:00:00.000Z), updatedAt: Date(2026-11-14T10:00:00.000Z)}).where(sql(("client_payment_claims"."id" = $1 and "client_payment_claims"."status" = $2) ["claim-1","pending"])).returning({id: client_payment_claims.id})';

const owner: OrgContext = { orgId: 'o-1', userId: 'u-1', role: 'owner' };
const viewer: OrgContext = { ...owner, role: 'viewer' };

const pendingClaim = { id: 'claim-1', engagementId: 'eng-1', milestoneKind: 'deposit', status: 'pending', confirmedPaymentEventId: null };
const liveEngagement = { state: 'created', designFee: '100000.0000' };
const amountMilestone = { basis: 'amount', value: '30000.0000' };
const racedPayment = { id: 'pay-7', kind: 'deposit', amount: '30000.0000' };

const confirm = (ctx: OrgContext, amount: string) => confirmPaymentClaimCore(ctx, { claimId: 'claim-1', amount });

let log: ReturnType<typeof vi.spyOn>;

/** The journal, that every scripted result was consumed, and how many lines were logged. */
function expectTrace(journal: string[], logged: number): void {
  expect(db.journal).toEqual(journal);
  expect(db.pending()).toBe(0);
  expect(log).toHaveBeenCalledTimes(logged);
}

/** The one line the unclassified tail logs: where, and the developer's own label. */
function expectLoggedInvariant(label: string): void {
  expect(log).toHaveBeenCalledWith('mutateInOrg failed', {
    reference: expect.any(String),
    failure: expect.objectContaining({ message: label }),
  });
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

describe('confirmPaymentClaimCore, before a transaction opens', () => {
  it('P1 refuses an unreadable amount under its field, opening nothing', async () => {
    expect(await confirm(owner, '1,5')).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'not_a_number' } },
    });
    expectTrace([], 0);
  });

  it('P2 reads the amount BEFORE the capability: a viewer with a bad amount hears about the amount', async () => {
    expect(await confirm(viewer, '1,5')).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { amount: { code: 'not_a_number' } },
    });
    expectTrace([], 0);
  });

  it('P3 refuses a viewer with a valid amount as forbidden, opening nothing', async () => {
    expect(await confirm(viewer, '30000')).toEqual({ ok: false, error: 'forbidden' });
    expectTrace([], 0);
  });
});

describe('confirmPaymentClaimCore, resolving the claim', () => {
  it('P4 refuses a workspace without the flow inside the transaction, before any statement', async () => {
    entitlement.enabled = false;
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'flow_not_enabled' });
    expectTrace(['begin', 'end'], 0);
  });

  it('P5 an absent claim is claim_not_found after the one locking read', async () => {
    db.respond([]);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_not_found' });
    expectTrace(['begin', LOCK_CLAIM, 'end'], 0);
  });

  it('P6 an already confirmed claim answers its payment with already: true and writes nothing', async () => {
    db.respond([{ ...pendingClaim, status: 'confirmed', confirmedPaymentEventId: 'pay-0' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: true, data: 'pay-0', already: true });
    expectTrace(['begin', LOCK_CLAIM, 'end'], 0);
  });

  it('P7 a confirmed claim WITHOUT its payment is a logged generic failure, never already', async () => {
    db.respond([{ ...pendingClaim, status: 'confirmed' }]);
    const result = await confirm(owner, '30000');
    expect(result).toMatchObject({ ok: false, error: 'generic' });
    expect(result).not.toHaveProperty('already');
    expect(result).not.toHaveProperty('data');
    expectTrace(['begin', LOCK_CLAIM, 'end'], 1);
    expectLoggedInvariant('confirmed claim without its payment event');
  });

  it('P8 a dismissed claim is claim_not_found', async () => {
    db.respond([{ ...pendingClaim, status: 'dismissed' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_not_found' });
    expectTrace(['begin', LOCK_CLAIM, 'end'], 0);
  });
});

describe('confirmPaymentClaimCore, is the claim still payable', () => {
  it('P9 a pending claim whose engagement does not resolve is engagement_not_found', async () => {
    db.respond([pendingClaim], []);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'engagement_not_found' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, 'end'], 0);
  });

  it('P10 an abandoned engagement is engagement_not_active, before the milestone is read', async () => {
    db.respond([pendingClaim], [{ state: 'abandoned', designFee: '100000.0000' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'engagement_not_active' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, 'end'], 0);
  });

  it('P11 an absent milestone owes nothing: claim_already_settled, the payments never read', async () => {
    db.respond([pendingClaim], [liveEngagement], []);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_already_settled' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, 'end'], 0);
  });

  it('P12 a milestone already paid in full is claim_already_settled, before any write', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [{ amount: '30000.0000' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_already_settled' });
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, 'end'], 0);
  });

  it('P13 a percent milestone with no design fee has no ceiling: the payments are not read and the money is recorded', async () => {
    db.respond(
      [pendingClaim],
      [{ state: 'created', designFee: null }],
      [{ basis: 'percent', value: '30.0000' }],
      [{ id: 'pay-1' }],
      [{ id: 'claim-1' }],
    );
    expect(await confirm(owner, '30000')).toEqual({ ok: true, data: 'pay-1', already: false });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, INSERT_PAYMENT, AUDIT_PAYMENT, FLIP_CLAIM_TO_PAY_1, 'end'],
      0,
    );
  });
});

describe('confirmPaymentClaimCore, recording the money and flipping the claim', () => {
  it('P14 the amount path: lock, lock, milestone, paid, insert, audit, flip; already: false', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [{ id: 'pay-1' }], [{ id: 'claim-1' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: true, data: 'pay-1', already: false });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, AUDIT_PAYMENT, FLIP_CLAIM_TO_PAY_1, 'end'],
      0,
    );
  });

  it('P15 a raced insert adopts the matching first-written payment: already: true and NO audit row', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [], [racedPayment], [{ id: 'claim-1' }]);
    expect(await confirm(owner, '30000')).toEqual({ ok: true, data: 'pay-7', already: true });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, READ_RACED_PAYMENT, FLIP_CLAIM_TO_PAY_7, 'end'],
      0,
    );
  });

  it('P16 a raced payment of ANOTHER kind aborts: logged generic, the claim never flipped', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [], [{ ...racedPayment, kind: 'balance' }]);
    const result = await confirm(owner, '30000');
    expect(result).toMatchObject({ ok: false, error: 'generic' });
    expect(result).not.toHaveProperty('already');
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, READ_RACED_PAYMENT, 'end'], 1);
    expectLoggedInvariant('claim payment event does not match the claim');
  });

  it('P16b a raced payment of ANOTHER amount aborts the same way', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [], [{ ...racedPayment, amount: '1.0000' }]);
    const result = await confirm(owner, '30000');
    expect(result).toMatchObject({ ok: false, error: 'generic' });
    expect(result).not.toHaveProperty('already');
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, READ_RACED_PAYMENT, 'end'], 1);
    expectLoggedInvariant('claim payment event does not match the claim');
  });

  it('P17 a raced insert whose winner cannot be read aborts: logged generic, the claim never flipped', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [], []);
    const result = await confirm(owner, '30000');
    expect(result).toMatchObject({ ok: false, error: 'generic' });
    expect(result).not.toHaveProperty('already');
    expectTrace(['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, READ_RACED_PAYMENT, 'end'], 1);
    expectLoggedInvariant('claim payment event does not match the claim');
  });

  it('P18 a flip that matches no row after a fresh insert is exactly claim_not_found, with no already', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [{ id: 'pay-1' }], []);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_not_found' });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, AUDIT_PAYMENT, FLIP_CLAIM_TO_PAY_1, 'end'],
      0,
    );
  });

  it('P19 a flip that matches no row after an ADOPTED payment is exactly claim_not_found, with no already', async () => {
    db.respond([pendingClaim], [liveEngagement], [amountMilestone], [], [], [racedPayment], []);
    expect(await confirm(owner, '30000')).toEqual({ ok: false, error: 'claim_not_found' });
    expectTrace(
      ['begin', LOCK_CLAIM, LOCK_ENGAGEMENT, READ_MILESTONE, READ_PAID, INSERT_PAYMENT, READ_RACED_PAYMENT, FLIP_CLAIM_TO_PAY_7, 'end'],
      0,
    );
  });
});
