import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A client's handover confirmation closes the delivery in the same request; a
// close that outlasts the wait finishes after the response, on the request's
// connection. That connection is HELD until the close settles, so the
// request's teardown cannot end it between the close's statements.

const deps = vi.hoisted(() => ({
  after: vi.fn(),
  hold: vi.fn(),
  readSdfJson: vi.fn(),
  resolveSystemContext: vi.fn(),
  closeAcknowledgedHandover: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: deps.after }));
vi.mock('@/lib/db/request-connection', () => ({ holdRequestConnectionUntil: deps.hold }));
vi.mock('@/lib/share/sdf-call', () => ({ normalizeRawToken: (token: string) => token, readSdfJson: deps.readSdfJson }));
vi.mock('@/lib/automation/system-context', () => ({ resolveSystemContext: deps.resolveSystemContext }));
vi.mock('../handover-close', () => ({ closeAcknowledgedHandover: deps.closeAcknowledgedHandover }));

const { HANDOVER_CLOSE_WAIT_MS, withHandoverClose } = await import('./handover-close');

const TARGET = { org_id: '11111111-1111-4111-8111-111111111111', engagement_id: '22222222-2222-4222-8222-222222222222' };

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.readSdfJson.mockResolvedValue(TARGET);
  deps.resolveSystemContext.mockResolvedValue({ orgId: TARGET.org_id, userId: 'system', role: 'owner' });
});

afterEach(() => vi.useRealTimers());

describe('a handover close that outlasts the wait', () => {
  it('holds the request connection for exactly the close that after() keeps', async () => {
    let finish!: (outcome: string) => void;
    deps.closeAcknowledgedHandover.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const answered = withHandoverClose('token', 'acknowledge_handoff', { ok: true }, async () => 'answer');
    await vi.advanceTimersByTimeAsync(HANDOVER_CLOSE_WAIT_MS + 1);
    expect(await answered).toBe('answer');
    expect(deps.hold).toHaveBeenCalledTimes(1);
    const [held] = deps.hold.mock.calls[0];
    expect(deps.after.mock.calls[0][0]()).toBe(held);
    finish('closed');
    await expect(held).resolves.toBe(true);
  });

  it('holds nothing when the close settles within the wait', async () => {
    deps.closeAcknowledgedHandover.mockResolvedValue('closed');
    expect(await withHandoverClose('token', 'acknowledge_handoff', { ok: true }, async () => 'answer')).toBe('answer');
    expect(deps.hold).not.toHaveBeenCalled();
    expect(deps.after).not.toHaveBeenCalled();
  });
});
