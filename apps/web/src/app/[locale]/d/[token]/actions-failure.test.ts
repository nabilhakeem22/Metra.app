import { beforeEach, describe, expect, it, vi } from 'vitest';

// Round E R3: the payment claim and a comment never throw to the client. When
// the token write gives up on a lock (55P03, once 0060's 4 s lock_timeout is
// live) the driver's error carries the failed query's parameters: the token
// hash, the client's IP and user agent, the comment body. The action answers
// the generic failure, and its ONE log line names the act and the SQLSTATE and
// carries none of them.

vi.mock('server-only', () => ({}));
vi.mock('./request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: async () => true, portalReadAllowed: async () => true }));

const LEAKY = Object.assign(
  new Error('Failed query: select public.app_delivery_comment_by_token(...) params: SECRET-HASH,doc,Is the wall moving?,,9.9.9.9,probe/1'),
  { cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }) },
);
const boom = vi.fn(async () => {
  throw LEAKY;
});
const notified = vi.fn();
vi.mock('@/lib/engagements/public', () => ({ claimPaymentByToken: boom }));
vi.mock('@/lib/engagements/public-comments', () => ({ addDeliveryCommentByToken: boom, getDeliveryDocumentCommentsByToken: vi.fn() }));
vi.mock('@/lib/engagements/client-acts/notify', () => ({ withStudioNotified: notified }));

const portal = await import('./actions');

const TOKEN = 'portal-link-token';
const DOCUMENT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  boom.mockClear();
  notified.mockClear();
});

describe('a claim or a comment whose write fails underneath (55P03)', () => {
  it.each([
    ['markDeliveryPaymentPaid', () => portal.markDeliveryPaymentPaid(TOKEN, 'deposit', 'Is the wall moving?')],
    ['addDeliveryComment', () => portal.addDeliveryComment(TOKEN, DOCUMENT, 'Is the wall moving?')],
  ])('%s answers the generic failure and logs one redacted line', async (name, call) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toEqual({ ok: false, studioNotified: false });
    expect(boom).toHaveBeenCalledTimes(1);
    expect(notified).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls);
    expect(line).toContain(name);
    expect(line).toContain('55P03');
    for (const secret of ['SECRET-HASH', 'Is the wall moving?', '9.9.9.9', 'probe/1', TOKEN]) expect(line).not.toContain(secret);
    logged.mockRestore();
  });
});
