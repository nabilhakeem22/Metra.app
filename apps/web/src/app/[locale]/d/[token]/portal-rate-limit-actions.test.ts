import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakePortalRateLimitEnv } from '@/test/fake-rate-limit-env';
import { PORTAL_ACT_CEILING, PORTAL_READ_CEILING } from '@/test/wrangler-rate-limits';

// Round D (W4): every server action under /d/[token] spends the link's act
// budget before it reaches a write; past it the action answers `too_many`
// (W3.5, AC 31: "wait a minute") and the write module is never called. A comment is charged only once it is a valid
// comment. A thread read spends the read budget and past it answers the REFUSED
// marker, never an empty thread. Ceilings come from wrangler.jsonc.

vi.mock('server-only', () => ({}));
const cf = vi.hoisted(() => ({ isCloudflareRuntime: vi.fn(() => true), cfEnv: vi.fn() }));
vi.mock('@/lib/cf/context', () => cf);
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: null, userAgent: null }) }));

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
const BAND_SEEN = '2026-10-01T09:00:00.123456+00:00';
const SEEN = { romIssuedAt: BAND_SEEN, rendersIssuedAt: '2026-10-02T09:00:00.000001+00:00' };

type Act = [name: string, call: () => Promise<unknown>, write: keyof typeof writes, refused: unknown];
const TOO_MANY_OUTCOME = { kind: 'error', error: 'too_many' };
const TOO_MANY_RESULT = { ok: false, error: 'too_many', studioNotified: false };
const ACTS: Act[] = [
  ['chooseDeliveryConcept', () => review.chooseDeliveryConcept(TOKEN, DOCUMENT_ID, 1), 'chooseConceptAndNotify', TOO_MANY_OUTCOME],
  ['respondToDeliveryConcept', () => review.respondToDeliveryConcept(TOKEN, 'approve_concept'), 'respondToConceptAndNotify', TOO_MANY_OUTCOME],
  ['respondToDeliveryDesign', () => review.respondToDeliveryDesign(TOKEN, 'approve_design', '', SEEN), 'respondToDesignAndNotify', TOO_MANY_OUTCOME],
  ['approveDesignWithBudget', () => review.approveDesignWithBudget(TOKEN, '', SEEN), 'approveDesignWithBudgetAndNotify', TOO_MANY_OUTCOME],
  ['acknowledgeDeliveryBudget', () => review.acknowledgeDeliveryBudget(TOKEN, BAND_SEEN), 'acknowledgeSeenBudgetAndNotify', TOO_MANY_OUTCOME],
  ['acknowledgeDeliveryHandover', () => review.acknowledgeDeliveryHandover(TOKEN), 'acknowledgeHandoverAndNotify', TOO_MANY_OUTCOME],
  ['markDeliveryPaymentPaid', () => portal.markDeliveryPaymentPaid(TOKEN, 'deposit'), 'claimPaymentByToken', TOO_MANY_RESULT],
  ['addDeliveryComment', () => portal.addDeliveryComment(TOKEN, DOCUMENT_ID, 'Looks good'), 'addDeliveryCommentByToken', TOO_MANY_RESULT],
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  cf.cfEnv.mockReturnValue(fakePortalRateLimitEnv());
  for (const write of Object.values(writes)) write.mockClear();
});

describe('the act budget on every portal server action', () => {
  it.each(ACTS)('%s: the act past the ceiling answers its refusal and writes nothing', async (_name, call, write, refused) => {
    for (let index = 0; index < PORTAL_ACT_CEILING; index += 1) await call();
    expect(writes[write]).toHaveBeenCalledTimes(PORTAL_ACT_CEILING);
    writes[write].mockClear();
    writes.withStudioNotified.mockClear();
    expect(await call()).toEqual(refused);
    expect(writes[write]).not.toHaveBeenCalled();
    expect(writes.withStudioNotified).not.toHaveBeenCalled();
  });

  it('the budget is per link, shared by every act of that link', async () => {
    for (let index = 0; index < PORTAL_ACT_CEILING; index += 1) await review.acknowledgeDeliveryHandover(TOKEN);
    expect(await portal.markDeliveryPaymentPaid(TOKEN, 'deposit')).toEqual(TOO_MANY_RESULT);
    expect(await portal.markDeliveryPaymentPaid('another-link', 'deposit')).toEqual({ ok: true, studioNotified: true });
  });
});

describe('R5: a comment is validated before it is charged', () => {
  it('an empty body or a malformed document id spends no act budget', async () => {
    const env = fakePortalRateLimitEnv();
    cf.cfEnv.mockReturnValue(env);
    for (let index = 0; index < PORTAL_ACT_CEILING + 5; index += 1) {
      expect(await portal.addDeliveryComment(TOKEN, DOCUMENT_ID, '   ')).toEqual({
        ok: false,
        error: 'check_fields',
        fields: { body: { code: 'required' } },
        studioNotified: false,
      });
      expect(await portal.addDeliveryComment(TOKEN, 'not-a-uuid', 'Hi')).toMatchObject({ ok: false, error: 'token_invalid' });
    }
    expect(env.PORTAL_ACT_RATE_LIMITER.limit).not.toHaveBeenCalled();
    expect(await review.acknowledgeDeliveryHandover(TOKEN)).toEqual({ kind: 'acknowledged', studioNotified: true });
  });
});

describe('the read budget on a comment thread', () => {
  it('the read past the ceiling answers REFUSED, not an empty thread, and looks nothing up', async () => {
    for (let index = 0; index < PORTAL_READ_CEILING; index += 1) await portal.loadDeliveryDocumentComments(TOKEN, DOCUMENT_ID);
    writes.getDeliveryDocumentCommentsByToken.mockClear();
    expect(await portal.loadDeliveryDocumentComments(TOKEN, DOCUMENT_ID)).toEqual({ refused: true });
    expect(writes.getDeliveryDocumentCommentsByToken).not.toHaveBeenCalled();
  });
});
