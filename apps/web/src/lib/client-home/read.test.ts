import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashShareToken } from '@/lib/share/token';
import { homePayload } from '@/test/client-home-payloads';

// getHomeByToken runs ONE token SDF over withRequestDb. The DB layer is an
// in-memory handle here, so the null and failed paths can be driven exactly as
// the delivery reader's are (lib/engagements/public/delivery.test.ts).
const db = vi.hoisted(() => ({
  rows: [] as Array<{ data: unknown }>,
  failure: null as Error | null,
  statements: [] as string[],
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (handle: { execute: (query: unknown) => unknown }) => unknown) =>
    run({
      execute: (query: unknown) => {
        db.statements.push(JSON.stringify(query));
        if (db.failure) throw db.failure;
        return db.rows;
      },
    }),
}));

const { getHomeByToken } = await import('./read');

afterEach(() => {
  db.rows = [];
  db.failure = null;
  db.statements = [];
  vi.restoreAllMocks();
});

describe('getHomeByToken', () => {
  it('answers ok with the shaped home, after one call of app_home_by_token with the hash', async () => {
    db.rows = [{ data: homePayload('works_in_progress') }];
    const read = await getHomeByToken('  raw-token  ');
    expect(read.status).toBe('ok');
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toContain('app_home_by_token');
    expect(db.statements[0]).toContain(hashShareToken('raw-token'));
    expect(db.statements[0]).not.toContain('"raw-token"');
  });

  it('a blank token is not_found with no round trip; the SDF null is not_found', async () => {
    expect(await getHomeByToken('   ')).toEqual({ status: 'not_found' });
    expect(db.statements).toHaveLength(0);
    db.rows = [{ data: null }];
    expect(await getHomeByToken('raw')).toEqual({ status: 'not_found' });
  });

  it('a payload this build cannot shape is not_found', async () => {
    db.rows = [{ data: { delivery: { number: 'x' } } }];
    expect(await getHomeByToken('raw')).toEqual({ status: 'not_found' });
  });

  it('a database failure is read_failed, logged without the token hash', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    // drizzle's query wrapper: its message and params carry the bound hash; the driver error below it does not.
    const driver = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    db.failure = Object.assign(new Error(`Failed query: select\nparams: ${hashShareToken('raw')}`), {
      query: 'select public.app_home_by_token($1) as data',
      params: [hashShareToken('raw')],
      cause: driver,
    });
    expect(await getHomeByToken('raw')).toEqual({ status: 'read_failed' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(hashShareToken('raw'));
  });

  it('facts no query can produce are read_failed, not a dead link', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = homePayload('pay_request');
    const execution = payload.execution as { flow_source: { contract: { money: Record<string, number> } } };
    Object.assign(execution.flow_source.contract.money, { unclaimed_due_requests: 5 });
    db.rows = [{ data: payload }];
    expect(await getHomeByToken('raw')).toEqual({ status: 'read_failed' });
  });
});
