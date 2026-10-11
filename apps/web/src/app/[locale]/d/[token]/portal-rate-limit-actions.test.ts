import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePortalRateLimitEnv } from '@/test/fake-rate-limit-env';

// Round D (W4): every server action under /d/[token] spends the link's act
// budget (30 a minute) before it reaches a write; past it the action answers its
// generic failure and the write module is never called. A thread read spends the
// read budget (300 a minute) and past it reads as an empty thread.

vi.mock('server-only', () => ({}));
const cf = vi.hoisted(() => ({ isCloudflareRuntime: vi.fn(() => true), cfEnv: vi.fn() }));
vi.mock('@/lib/cf/context', () => cf);
vi.mock('./request-provenance', () => ({ requestProvenance: async () => ({ ip: null, userAgent: null }) }));

const writes = vi.hoisted(() => ({
  chooseConceptAndNotify: vi.fn(async () => ({ kind: 'approved', studioNotified: true })),
  respondToConceptAndNotify: vi.fn(async () => ({ kind: 'approved', studioNotified: true })),
  respondToDesignAndNotify: vi.fn(async () => ({ kind: 'approved', studioNotified: true })),
  approveDesignWithBudgetAndNotify: vi.fn(async () => ({ kind: 'approved', studioNotified: true })),
  acknowledgeSeenBudgetAndNotify: vi.fn(async () => ({ kind: 'acknowledged', studioNotified: true })),
  acknowledgeHandoverAndNotify: vi.fn(async () => ({ kind: 'acknowledged', studioNotified: true })),
  claimPaymentByToken: vi.fn(async () => ({ ok: true })),
  addDeliveryCommentByToken: vi.fn(async () => ({ ok: true })),
  getDeliveryDocumentCommentsByToken: vi.fn(async () => [{ body: 'hello' }]),
  withStudioNotified: vi.fn(async (_token: string, result: object) => ({ ...result, studioNotified: true })),
}));
vi.mock('@/lib/engagements/client-acts/concept-acts', () => writes);
vi.mock('@/lib/engagements/client-acts/design-acts', () => writes);
vi.mock('@/lib/engagements/client-acts/budget-acts', () => writes);
vi.mock('@/lib/engagements/client-acts/handover-acts', () => writes);
vi.mock('@/lib/engagements/client-acts/notify', () => writes);
vi.mock('@/lib/engagements/client-acts/acts', () => ({ paymentClaimedAct: (kind: string) => ({ kind }) }));
vi.mock('@/lib/engagements/public', () => writes);
vi.mock('@/lib/engagements/public-comments', () => writes);

const review = await import('./review-actions');
const portal = await import('./actions');

const TOKEN = 'portal-link-token';
const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SEEN = { band: '100|200', round: 'r1' };

type Act = [name: string, call: () => Promise<unknown>, write: keyof typeof writes, refused: unknown];
const GENERIC_OUTCOME = { kind: 'error', error: 'generic' };
const GENERIC_RESULT = { ok: false, studioNotified: false };
const ACTS: Act[] = [
  ['chooseDeliveryConcept', () => review.chooseDeliveryConcept(TOKEN, DOCUMENT_ID, 1), 'chooseConceptAndNotify', GENERIC_OUTCOME],
  ['respondToDeliveryConcept', () => review.respondToDeliveryConcept(TOKEN, 'approve_concept'), 'respondToConceptAndNotify', GENERIC_OUTCOME],
  ['respondToDeliveryDesign', () => review.respondToDeliveryDesign(TOKEN, 'approve_design', '', SEEN), 'respondToDesignAndNotify', GENERIC_OUTCOME],
  ['approveDesignWithBudget', () => review.approveDesignWithBudget(TOKEN, '', SEEN), 'approveDesignWithBudgetAndNotify', GENERIC_OUTCOME],
  ['acknowledgeDeliveryBudget', () => review.acknowledgeDeliveryBudget(TOKEN, '100|200'), 'acknowledgeSeenBudgetAndNotify', GENERIC_OUTCOME],
  ['acknowledgeDeliveryHandover', () => review.acknowledgeDeliveryHandover(TOKEN), 'acknowledgeHandoverAndNotify', GENERIC_OUTCOME],
  ['markDeliveryPaymentPaid', () => portal.markDeliveryPaymentPaid(TOKEN, 'deposit'), 'claimPaymentByToken', GENERIC_RESULT],
  ['addDeliveryComment', () => portal.addDeliveryComment(TOKEN, DOCUMENT_ID, 'Looks good'), 'addDeliveryCommentByToken', GENERIC_RESULT],
];

beforeEach(() => {
  cf.cfEnv.mockReturnValue(fakePortalRateLimitEnv());
  for (const write of Object.values(writes)) write.mockClear();
});

describe('the act budget on every portal server action', () => {
  it.each(ACTS)('%s: the 31st act in a minute answers the generic failure and writes nothing', async (_name, call, write, refused) => {
    for (let index = 0; index < 30; index += 1) await call();
    expect(writes[write]).toHaveBeenCalledTimes(30);
    writes[write].mockClear();
    writes.withStudioNotified.mockClear();
    expect(await call()).toEqual(refused);
    expect(writes[write]).not.toHaveBeenCalled();
    expect(writes.withStudioNotified).not.toHaveBeenCalled();
  });

  it('the budget is per link, shared by every act of that link', async () => {
    for (let index = 0; index < 30; index += 1) await review.acknowledgeDeliveryHandover(TOKEN);
    expect(await portal.markDeliveryPaymentPaid(TOKEN, 'deposit')).toEqual(GENERIC_RESULT);
    expect(await portal.markDeliveryPaymentPaid('another-link', 'deposit')).toEqual({ ok: true, studioNotified: true });
  });
});

describe('the read budget on a comment thread', () => {
  it('the 301st read in a minute is an empty thread, nothing looked up', async () => {
    for (let index = 0; index < 300; index += 1) await portal.loadDeliveryDocumentComments(TOKEN, DOCUMENT_ID);
    writes.getDeliveryDocumentCommentsByToken.mockClear();
    expect(await portal.loadDeliveryDocumentComments(TOKEN, DOCUMENT_ID)).toEqual([]);
    expect(writes.getDeliveryDocumentCommentsByToken).not.toHaveBeenCalled();
  });
});
