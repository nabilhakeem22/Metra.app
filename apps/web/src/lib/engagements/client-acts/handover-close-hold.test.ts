import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The handover close and the REAL request connection together (overnight
// round, R4). The hold used to cover the close's 4 s answer, not the close:
// at 4 s the teardown ended the connection, and a close statement issued
// after that (the deadline falling between two statements, as on a slow
// link) never ran on it. Now the connection stays open until the close
// itself settles, within the teardown's cap.

const runtime = vi.hoisted(() => ({ ctx: { waitUntil: vi.fn() as ReturnType<typeof vi.fn> } }));
const afterCallbacks = vi.hoisted(() => [] as Array<() => unknown>);
const connections = vi.hoisted(() => [] as Array<{ ended: boolean; end: ReturnType<typeof vi.fn> }>);
const createDb = vi.hoisted(() =>
  vi.fn(() => {
    const sql = { ended: false, end: vi.fn(async () => { sql.ended = true; }) };
    connections.push(sql);
    return { db: {}, sql };
  }),
);
const deps = vi.hoisted(() => ({ readSdfJson: vi.fn(), resolveSystemContext: vi.fn(), closeAcknowledgedHandover: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: (callback: () => unknown) => void afterCallbacks.push(callback) }));
vi.mock('@/lib/cf/context', () => ({
  isCloudflareRuntime: () => true,
  cfEnv: () => ({ HYPERDRIVE: { connectionString: 'postgres://u:p@host/db' } }),
  cfExecutionContext: () => runtime.ctx,
}));
vi.mock('@metra/db', () => ({ createDb }));
vi.mock('@/lib/share/sdf-call', () => ({ normalizeRawToken: (token: string) => token, readSdfJson: deps.readSdfJson }));
vi.mock('@/lib/automation/system-context', () => ({ resolveSystemContext: deps.resolveSystemContext }));
vi.mock('../handover-close', () => ({ closeAcknowledgedHandover: deps.closeAcknowledgedHandover }));

const { getRequestConnection } = await import('@/lib/db/request-connection');
const { HANDOVER_CLOSE_BUDGET_MS, HANDOVER_CLOSE_WAIT_MS, withHandoverClose } = await import('./handover-close');

const TARGET = { org_id: '11111111-1111-4111-8111-111111111111', engagement_id: '22222222-2222-4222-8222-222222222222' };
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What each close statement found: the connection it ran on, and whether that one had been ended. */
const statements: Array<{ connection: number; ended: boolean }> = [];
function runStatement(): void {
  const { sql } = getRequestConnection() as unknown as { sql: { ended: boolean } };
  const connection = connections.indexOf(sql as (typeof connections)[number]);
  statements.push({ connection, ended: sql.ended });
  if (sql.ended) throw Object.assign(new Error('write CONNECTION_ENDED'), { code: 'CONNECTION_ENDED' });
}

beforeEach(() => {
  vi.useFakeTimers();
  runtime.ctx = { waitUntil: vi.fn() };
  afterCallbacks.length = 0;
  connections.length = 0;
  statements.length = 0;
  createDb.mockClear();
  // Target read at once, the actor at 2 s, the close's transaction at 4.5 s: the 4 s deadline falls between them.
  deps.readSdfJson.mockImplementation(async () => { runStatement(); return TARGET; });
  deps.resolveSystemContext.mockImplementation(async () => { await later(2_000); runStatement(); return { orgId: TARGET.org_id, userId: 'system', role: 'owner' }; });
  deps.closeAcknowledgedHandover.mockImplementation(async () => { await later(2_500); runStatement(); return 'closed'; });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a handover close whose deadline falls between two of its statements', () => {
  it('keeps the request connection until the close commits, then ends it once, and logs that it finished', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answered = withHandoverClose('token', 'acknowledge_handoff', { ok: true }, async () => 'answer');
    await vi.advanceTimersByTimeAsync(HANDOVER_CLOSE_WAIT_MS);
    expect(await answered).toBe('answer');

    // The response is sent: Next starts every after() callback at once.
    for (const callback of afterCallbacks) void callback();
    await vi.advanceTimersByTimeAsync(HANDOVER_CLOSE_BUDGET_MS);
    await (runtime.ctx.waitUntil.mock.calls[0][0] as Promise<void>);

    expect(statements).toEqual([{ connection: 0, ended: false }, { connection: 0, ended: false }, { connection: 0, ended: false }]);
    expect(createDb).toHaveBeenCalledTimes(1);
    expect(connections[0].end).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith('handover close still running past its deadline:', { deadlineMs: HANDOVER_CLOSE_BUDGET_MS });
    expect(warned).toHaveBeenLastCalledWith('handover close finished after its deadline:', { closed: true });
    expect(failed).not.toHaveBeenCalled();
  });
});
