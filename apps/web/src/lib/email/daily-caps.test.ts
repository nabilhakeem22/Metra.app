import { beforeEach, describe, expect, it, vi } from 'vitest';

// S4 (go-live security): the cap verdict, its window, and its failure mode. The
// counts are replaced; tests/actions/daily-email-caps.dbtest.ts runs the real
// queries against a seeded database.

vi.mock('server-only', () => ({}));
const counts = vi.hoisted(() => ({ countTeamInviteEmailsSince: vi.fn(), countClientEmailsSince: vi.fn() }));
vi.mock('./daily-cap-queries', () => counts);

const { DAILY_EMAIL_CAPS, DAILY_EMAIL_CAP_WINDOW_MS, dailyEmailCapReached } = await import('./daily-caps');

const CTX = { orgId: 'org-1', userId: 'u1', userEmail: 'owner@studio.example', role: 'owner' } as const;

beforeEach(() => {
  counts.countTeamInviteEmailsSince.mockReset().mockResolvedValue(0);
  counts.countClientEmailsSince.mockReset().mockResolvedValue(0);
});

describe('dailyEmailCapReached', () => {
  it('keeps the owner-decided caps over a rolling day', () => {
    expect(DAILY_EMAIL_CAPS).toEqual({ team_invite: 20, client_email: 60 });
    expect(DAILY_EMAIL_CAP_WINDOW_MS).toBe(86_400_000);
  });

  it('counts from 24 hours ago', async () => {
    const before = Date.now();
    await dailyEmailCapReached(CTX, 'team_invite');
    const since = counts.countTeamInviteEmailsSince.mock.calls[0]?.[1] as Date;
    expect(before - since.getTime()).toBeGreaterThanOrEqual(DAILY_EMAIL_CAP_WINDOW_MS);
    expect(before - since.getTime()).toBeLessThan(DAILY_EMAIL_CAP_WINDOW_MS + 1000);
  });

  it('is reached at the cap, not one before it', async () => {
    counts.countTeamInviteEmailsSince.mockResolvedValue(19);
    expect(await dailyEmailCapReached(CTX, 'team_invite')).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    counts.countClientEmailsSince.mockResolvedValue(60);
    expect(await dailyEmailCapReached(CTX, 'client_email')).toBe(true);
    expect(warn).toHaveBeenCalledWith('daily email cap reached:', { cap: 'client_email' });
    warn.mockRestore();
  });

  it('fails open on a database error, with one log line and no address', async () => {
    counts.countClientEmailsSince.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await dailyEmailCapReached(CTX, 'client_email')).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toBe('daily email cap count failed (failing open):');
    expect(JSON.stringify(error.mock.calls)).not.toContain('@');
    error.mockRestore();
  });
});
