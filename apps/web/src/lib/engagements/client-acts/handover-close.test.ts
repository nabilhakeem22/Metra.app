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

const { HANDOVER_CLOSE_BUDGET_MS, HANDOVER_CLOSE_WAIT_MS, closeHandoverByToken, withHandoverClose } = await import('./handover-close');

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
    // The close ITSELF is held (R4 of the overnight round), not its 4 s answer.
    await expect(held).resolves.toEqual({ closed: true });
  });

  it('holds nothing when the close settles within the wait', async () => {
    deps.closeAcknowledgedHandover.mockResolvedValue('closed');
    expect(await withHandoverClose('token', 'acknowledge_handoff', { ok: true }, async () => 'answer')).toBe('answer');
    expect(deps.hold).not.toHaveBeenCalled();
    expect(deps.after).not.toHaveBeenCalled();
  });
});

// R6: on a slow link the close logged "failed" at its 4 s deadline and then
// committed seconds later. The deadline bounds the WAIT, not the work.
describe('a handover close that outlasts its deadline', () => {
  afterEach(() => vi.restoreAllMocks());

  const pendingClose = () => {
    let settle!: { finish: (outcome: string) => void; fail: (error: Error) => void };
    deps.closeAcknowledgedHandover.mockReturnValue(new Promise((resolve, reject) => { settle = { finish: resolve, fail: reject }; }));
    return () => settle;
  };

  it('logs that it is still running, never "failed", then the outcome it reached', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settle = pendingClose();
    const closed = closeHandoverByToken('token');
    await vi.advanceTimersByTimeAsync(HANDOVER_CLOSE_BUDGET_MS);
    expect(await closed).toBe(false);
    expect(warned).toHaveBeenCalledWith('handover close still running past its deadline:', { deadlineMs: HANDOVER_CLOSE_BUDGET_MS });
    settle().finish('closed');
    await vi.advanceTimersByTimeAsync(0);
    expect(warned).toHaveBeenLastCalledWith('handover close finished after its deadline:', { closed: true });
    expect(failed).not.toHaveBeenCalled();
  });

  it('logs a close that fails after its deadline as failed after it, redacted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const settle = pendingClose();
    const closed = closeHandoverByToken('token');
    await vi.advanceTimersByTimeAsync(HANDOVER_CLOSE_BUDGET_MS);
    await closed;
    expect(failed).not.toHaveBeenCalled();
    settle().fail(new Error('write CONNECTION_ENDED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toBe('handover close by token failed after its deadline:');
  });

  it('logs a close that fails within its deadline as failed', async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    deps.closeAcknowledgedHandover.mockRejectedValue(new Error('refused'));
    expect(await closeHandoverByToken('token')).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0][0]).toBe('handover close by token failed:');
  });
});
