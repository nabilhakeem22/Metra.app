import { beforeEach, describe, expect, it, vi } from 'vitest';

// Round E R3: the payment claim and a comment never throw to the client. When
// the token write gives up on a lock (55P03, once 0060's 4 s lock_timeout is
// live) the driver's error carries the failed query's parameters: the token
// hash, the client's IP and user agent, the comment body. The action answers
// `uncertain` (W3.5, AC 31: the write may still commit, so the client is told
// to refresh and check), and its ONE log line names the act and the SQLSTATE
// and carries none of them. Any other throw answers `generic` with a reference,
// the same one its log line carries.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: '9.9.9.9', userAgent: 'probe/1' }) }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalActAllowed: async () => true, portalReadAllowed: async () => true }));

const LEAKY = Object.assign(
  new Error('Failed query: select public.app_delivery_comment_by_token(...) params: SECRET-HASH,doc,Is the wall moving?,,9.9.9.9,probe/1'),
  { cause: Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', severity: 'ERROR' }) },
);
const boom = vi.fn(async (): Promise<never> => {
  throw LEAKY;
});
const notified = vi.fn();
vi.mock('@/lib/engagements/public', () => ({ claimPaymentByToken: boom }));
vi.mock('@/lib/engagements/public-comments', () => ({ addDeliveryCommentByToken: boom, getDeliveryDocumentCommentsByToken: boom }));
vi.mock('@/lib/engagements/client-acts/notify', () => ({ withStudioNotified: notified }));

const portal = await import('./actions');

const TOKEN = 'portal-link-token';
const DOCUMENT = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  boom.mockClear();
  notified.mockClear();
});

const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['markDeliveryPaymentPaid', () => portal.markDeliveryPaymentPaid(TOKEN, 'deposit', 'Is the wall moving?')],
  ['addDeliveryComment', () => portal.addDeliveryComment(TOKEN, DOCUMENT, 'Is the wall moving?')],
];

describe('a claim or a comment whose write fails underneath (55P03)', () => {
  it.each(CALLS)('%s answers uncertain and logs one redacted line', async (name, call) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call()).toEqual({ ok: false, error: 'uncertain', studioNotified: false });
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

describe('a claim or a comment whose write fails for any other reason', () => {
  it.each(CALLS)('%s answers generic with the reference its one log line carries', async (name, call) => {
    boom.mockImplementationOnce(async () => {
      throw new Error('renderer crashed');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = (await call()) as { error: string; reference: string };
    expect(answer).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(/^[0-9A-Z]{8}$/), studioNotified: false });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][0]).toBe('portal act failed');
    expect(logged.mock.calls[0][1]).toMatchObject({ act: name, reference: answer.reference });
    logged.mockRestore();
  });
});

describe('inputs a direct invocation can send (Round E F1)', () => {
  it.each([[123], [{}], [['x']], [null], [undefined]])('a comment body of %j is refused under the box, never throws, writes nothing', async (body) => {
    expect(await portal.addDeliveryComment(TOKEN, DOCUMENT, body as never)).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { body: { code: 'required' } },
      studioNotified: false,
    });
    expect(boom).not.toHaveBeenCalled();
  });

  it('a comment past the cap is refused under the box, not cut short', async () => {
    expect(await portal.addDeliveryComment(TOKEN, DOCUMENT, 'x'.repeat(2001))).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { body: { code: 'too_long', params: { max: 2000 } } },
      studioNotified: false,
    });
    expect(boom).not.toHaveBeenCalled();
  });

  it('a thread read that fails underneath answers the empty thread and logs one redacted line', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await portal.loadDeliveryDocumentComments(TOKEN, DOCUMENT)).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logged.mock.calls)).not.toContain('SECRET-HASH');
    logged.mockRestore();
  });
});
