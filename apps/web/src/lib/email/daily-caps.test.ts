import type { MetraDb } from '@metra/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// S4 (go-live security): the cap verdict, its window, its lock and its failure
// modes (the lock fails CLOSED, the count fails open). The counts and the
// transaction are replaced;
// tests/actions/daily-email-caps*.dbtest.ts run the real queries and the real
// lock against a seeded database, under concurrency.

vi.mock('server-only', () => ({}));
const counts = vi.hoisted(() => ({ countTeamInviteEmailsSince: vi.fn(), countClientEmailsSince: vi.fn() }));
vi.mock('./daily-cap-queries', () => counts);

const { DAILY_EMAIL_CAPS, DAILY_EMAIL_CAP_WINDOW_MS, claimDailyEmail } = await import('./daily-caps');
const { ActionError } = await import('@/lib/actions/result');

const ORG = '11111111-1111-4111-8111-111111111111';
const dialect = new PgDialect();
let steps: string[];
let tx: { execute: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
const db = () => tx as unknown as MetraDb;

beforeEach(() => {
  steps = [];
  tx = {
    execute: vi.fn(async (query: SQL) => {
      const { sql, params } = dialect.sqlToQuery(query);
      steps.push(`${sql} ${JSON.stringify(params)}`);
    }),
    transaction: vi.fn(async (fn: (savepoint: unknown) => Promise<unknown>) => {
      steps.push('savepoint');
      return fn(tx);
    }),
  };
  const counted = (value: number) => async () => {
    steps.push('count');
    return value;
  };
  counts.countTeamInviteEmailsSince.mockReset().mockImplementation(counted(0));
  counts.countClientEmailsSince.mockReset().mockImplementation(counted(0));
});

describe('claimDailyEmail', () => {
  it('keeps the owner-decided caps over a rolling day', () => {
    expect(DAILY_EMAIL_CAPS).toEqual({ team_invite: 20, client_email: 60 });
    expect(DAILY_EMAIL_CAP_WINDOW_MS).toBe(86_400_000);
  });

  it('takes the (org, cap) transaction lock on the caller transaction, then counts in a savepoint', async () => {
    expect(await claimDailyEmail(db(), ORG, 'team_invite')).toBe(true);
    expect(steps).toEqual([`select pg_advisory_xact_lock(hashtext($1)) ["${ORG}:email-cap:team_invite"]`, 'savepoint', 'count']);
    expect(counts.countTeamInviteEmailsSince.mock.calls[0]?.[0]).toBe(tx);
  });

  it('keeps the two caps on separate locks', async () => {
    await claimDailyEmail(db(), ORG, 'client_email');
    expect(steps[0]).toContain(`${ORG}:email-cap:client_email`);
  });

  it('counts from 24 hours ago', async () => {
    const now = new Date('2026-10-27T12:00:00.000Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    try {
      await claimDailyEmail(db(), ORG, 'team_invite');
    } finally {
      vi.useRealTimers();
    }
    const since = counts.countTeamInviteEmailsSince.mock.calls[0]?.[1] as Date;
    expect(now.getTime() - since.getTime()).toBe(DAILY_EMAIL_CAP_WINDOW_MS);
  });

  it('allows one before the cap and refuses at it, logging the cap only', async () => {
    counts.countTeamInviteEmailsSince.mockResolvedValue(19);
    expect(await claimDailyEmail(db(), ORG, 'team_invite')).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    counts.countClientEmailsSince.mockResolvedValue(60);
    expect(await claimDailyEmail(db(), ORG, 'client_email')).toBe(false);
    expect(warn).toHaveBeenCalledWith('daily email cap reached:', { cap: 'client_email' });
    warn.mockRestore();
  });

  it('fails open when the COUNT errors, with one log line and no address', async () => {
    counts.countClientEmailsSince.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimDailyEmail(db(), ORG, 'client_email')).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('daily email cap count failed (failing open):');
    expect(JSON.stringify(error.mock.calls)).not.toContain('@');
    error.mockRestore();
  });

  it.each([
    ['a lock wait past lock_timeout', Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })],
    ['a cancelled statement', Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })],
    ['a transaction timeout', Object.assign(new Error('terminating connection due to transaction timeout'), { code: '25P04' })],
    ['any other error', new Error('connect ECONNREFUSED')],
  ])('fails CLOSED as busy on %s taking the lock, and never counts', async (_label, lockError) => {
    tx.execute.mockRejectedValueOnce(lockError);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const claim = claimDailyEmail(db(), ORG, 'team_invite');
    await expect(claim).rejects.toBeInstanceOf(ActionError);
    await expect(claim).rejects.toMatchObject({ code: 'busy' });
    expect(counts.countTeamInviteEmailsSince).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('daily email cap lock busy:');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(ORG);
    warn.mockRestore();
  });
});
