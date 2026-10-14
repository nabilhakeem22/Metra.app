import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { confirmPaymentClaimAndAdvanceCore } from './confirm-claim-and-advance';

vi.mock('server-only', () => ({}));

// The DB-facing collaborators are doubles: what is pinned here is the ORDER of
// the reads (R5). The real flows are tests/actions/delivery-payment-claim.dbtest.ts.
const io = vi.hoisted(() => ({
  gate: { engagementId: 'e-1', milestoneKind: 'balance', state: 'execution_decision' },
  preview: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('./payment-claims', () => ({
  confirmPaymentClaimCore: async () => ({ ok: true, data: 'pay-1' }),
}));
vi.mock('@/lib/db/context', () => ({
  withOrgContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => {
    const chain = {
      select: () => chain,
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: async () => [io.gate],
    };
    return fn(chain);
  },
}));
vi.mock('./gate-preview', () => ({ getEngagementGatePreview: io.preview }));
vi.mock('./executor', () => ({ executeTransition: io.execute }));

const CTX = { orgId: 'o-1', userId: 'u-1', role: 'owner' } as OrgContext;
const CLAIM = { claimId: '11111111-1111-4111-8111-111111111111', amount: '30000' };

beforeEach(() => {
  io.preview.mockReset();
  io.execute.mockReset();
});

describe('confirmPaymentClaimAndAdvanceCore: the review read is spent only when it matters', () => {
  test('a claim that opens no forward move never reads the review', async () => {
    io.gate = { engagementId: 'e-1', milestoneKind: 'balance', state: 'execution_decision' };
    const res = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(res).toMatchObject({ ok: true, paymentRecorded: true, advanced: false });
    expect(io.preview).not.toHaveBeenCalled();
    expect(io.execute).not.toHaveBeenCalled();
  });

  test('a claim that pays the forward gate reads the review, and holds while it is owed', async () => {
    io.gate = { engagementId: 'e-1', milestoneKind: 'gate_a', state: 'concept_review' };
    io.preview.mockResolvedValue({ awaitingClientReview: true, items: [] });
    const res = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(io.preview).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ advanced: false, waitingOn: 'client_review_pending' });
    expect(io.execute).not.toHaveBeenCalled();
  });

  test('once the client has answered, it advances', async () => {
    io.gate = { engagementId: 'e-1', milestoneKind: 'gate_a', state: 'concept_review' };
    io.preview.mockResolvedValue({ awaitingClientReview: false, items: [] });
    io.execute.mockResolvedValue({ ok: true });
    const res = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(res).toMatchObject({ advanced: true });
    expect(io.execute).toHaveBeenCalledWith(CTX, { engagementId: 'e-1', trigger: 'selectConcept' });
  });

  test('after the payment is saved, an advance that gave no answer is never "try again" (F12)', async () => {
    io.gate = { engagementId: 'e-1', milestoneKind: 'gate_a', state: 'concept_review' };
    io.preview.mockResolvedValue({ awaitingClientReview: false, items: [] });
    io.execute.mockResolvedValue({ ok: false, error: 'uncertain' });
    const uncertain = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(uncertain).toMatchObject({ ok: true, paymentRecorded: true, advanced: false, waitingOn: 'advance_unconfirmed' });

    io.execute.mockResolvedValue({ ok: false, error: 'gate_a_not_cleared' });
    const refused = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(refused).toMatchObject({ ok: true, advanced: false, waitingOn: 'gate_a_not_cleared' });

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    io.preview.mockRejectedValue(new Error('connection reset'));
    const unread = await confirmPaymentClaimAndAdvanceCore(CTX, CLAIM);
    expect(unread).toMatchObject({ ok: true, paymentRecorded: true, waitingOn: 'advance_unconfirmed' });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
