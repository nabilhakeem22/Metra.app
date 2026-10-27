import type { MetraDb } from '@metra/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// S4 (go-live security): the cap verdict, its window, its lock and its failure
// mode. The counts and the transaction are replaced;
// tests/actions/daily-email-caps*.dbtest.ts run the real queries and the real
// lock against a seeded database, under concurrency.

vi.mock('server-only', () => ({}));
const counts = vi.hoisted(() => ({ countTeamInviteEmailsSince: vi.fn(), countClientEmailsSince: vi.fn() }));
vi.mock('./daily-cap-queries', () => counts);

const { DAILY_EMAIL_CAPS, DAILY_EMAIL_CAP_WINDOW_MS, claimDailyEmail } = await import('./daily-caps');

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

  it('takes the (org, cap) transaction lock in a savepoint BEFORE it counts, on the caller transaction', async () => {
    expect(await claimDailyEmail(db(), ORG, 'team_invite')).toBe(true);
    expect(steps).toEqual(['savepoint', `select pg_advisory_xact_lock(hashtext($1)) ["${ORG}:email-cap:team_invite"]`, 'count']);
    expect(counts.countTeamInviteEmailsSince.mock.calls[0]?.[0]).toBe(tx);
  });

  it('keeps the two caps on separate locks', async () => {
    await claimDailyEmail(db(), ORG, 'client_email');
    expect(steps[1]).toContain(`${ORG}:email-cap:client_email`);
  });

  it('counts from 24 hours ago', async () => {
    const before = Date.now();
    await claimDailyEmail(db(), ORG, 'team_invite');
    const since = counts.countTeamInviteEmailsSince.mock.calls[0]?.[1] as Date;
    expect(before - since.getTime()).toBeGreaterThanOrEqual(DAILY_EMAIL_CAP_WINDOW_MS);
    expect(before - since.getTime()).toBeLessThan(DAILY_EMAIL_CAP_WINDOW_MS + 1000);
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

  it('fails open on a database error, with one log line and no address', async () => {
    counts.countClientEmailsSince.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await claimDailyEmail(db(), ORG, 'client_email')).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('daily email cap count failed (failing open):');
    expect(JSON.stringify(error.mock.calls)).not.toContain('@');
    error.mockRestore();
  });
});
