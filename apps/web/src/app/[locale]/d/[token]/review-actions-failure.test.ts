import { beforeEach, describe, expect, it, vi } from 'vitest';

// D3 L1: no review action throws to the client. A failure underneath (a
// database error whose message carries the failed query's parameters: the
// token hash, the client's IP and user agent, the note) answers the generic
// error, and the ONE log line it writes carries none of them.

vi.mock('server-only', () => ({}));
vi.mock('./request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));

const LEAKY = Object.assign(new Error('Failed query: select ... params: SECRET-HASH,approve_design,x,my private note,,9.9.9.9,probe/1'), {
  cause: Object.assign(new Error('date/time field value out of range'), { code: '57014', severity: 'ERROR' }),
});
const boom = vi.fn(async () => {
  throw LEAKY;
});
vi.mock('@/lib/engagements/client-acts/concept-acts', () => ({ chooseConceptAndNotify: boom, respondToConceptAndNotify: boom }));
vi.mock('@/lib/engagements/client-acts/design-acts', () => ({ respondToDesignAndNotify: boom, approveDesignWithBudgetAndNotify: boom }));
vi.mock('@/lib/engagements/client-acts/budget-acts', () => ({ acknowledgeSeenBudgetAndNotify: boom }));
vi.mock('@/lib/engagements/client-acts/handover-acts', () => ({ acknowledgeHandoverAndNotify: boom }));

const review = await import('./review-actions');

const TOKEN = 'portal-link-token';
const STAMP = '2026-10-01T09:00:00.123456+00:00';
const SEEN = { romIssuedAt: STAMP, rendersIssuedAt: STAMP };

const ACTS: Array<[string, () => Promise<unknown>]> = [
  ['chooseDeliveryConcept', () => review.chooseDeliveryConcept(TOKEN, '11111111-1111-4111-8111-111111111111', 1, 'my private note')],
  ['respondToDeliveryConcept', () => review.respondToDeliveryConcept(TOKEN, 'approve_concept', 'my private note')],
  ['respondToDeliveryDesign', () => review.respondToDeliveryDesign(TOKEN, 'approve_design', 'my private note', SEEN)],
  ['approveDesignWithBudget', () => review.approveDesignWithBudget(TOKEN, 'my private note', SEEN)],
  ['acknowledgeDeliveryBudget', () => review.acknowledgeDeliveryBudget(TOKEN, STAMP)],
  ['acknowledgeDeliveryHandover', () => review.acknowledgeDeliveryHandover(TOKEN, 'my private note')],
];

beforeEach(() => {
  boom.mockClear();
});

describe('a review action that fails underneath', () => {
  it.each(ACTS)('%s answers the generic error and logs one redacted line', async (name, call) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toEqual({ kind: 'error', error: 'generic' });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls);
    expect(line).toContain(name);
    for (const secret of ['SECRET-HASH', 'my private note', '9.9.9.9', 'probe/1', TOKEN]) expect(line).not.toContain(secret);
    logged.mockRestore();
  });
});
