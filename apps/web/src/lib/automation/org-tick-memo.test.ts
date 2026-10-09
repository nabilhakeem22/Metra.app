import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetraDb } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import { createOrgTickMemo, sharedInFlightDeliveries } from './org-tick-memo';

vi.mock('server-only', () => ({}));
const due = vi.hoisted(() => ({ inFlightDeliveries: vi.fn() }));
vi.mock('./delivery-due-work', () => due);

const ctx = { orgId: 'org-1', userId: 'owner-1', role: 'owner' } as OrgContext;
const now = new Date('2026-10-14T04:00:00Z');
const tx = {} as MetraDb;

beforeEach(() => due.inFlightDeliveries.mockReset());

describe('sharedInFlightDeliveries (R1)', () => {
  it('reads once per org per tick, whichever core asks first', async () => {
    due.inFlightDeliveries.mockResolvedValue({ deliveries: [], capped: false });
    const deps = { ctx, now, memo: createOrgTickMemo() };
    const digest = await sharedInFlightDeliveries(deps, tx);
    const followups = await sharedInFlightDeliveries(deps, tx);
    expect(followups).toBe(digest);
    expect(due.inFlightDeliveries).toHaveBeenCalledTimes(1);
    expect(due.inFlightDeliveries).toHaveBeenCalledWith(tx, 'owner', now);
  });

  it('a failed read is not shared: the next core reads again', async () => {
    due.inFlightDeliveries.mockRejectedValueOnce(new Error('timeout'));
    due.inFlightDeliveries.mockResolvedValueOnce({ deliveries: [], capped: false });
    const deps = { ctx, now, memo: createOrgTickMemo() };
    await expect(sharedInFlightDeliveries(deps, tx)).rejects.toThrow('timeout');
    await expect(sharedInFlightDeliveries(deps, tx)).resolves.toEqual({ deliveries: [], capped: false });
    expect(due.inFlightDeliveries).toHaveBeenCalledTimes(2);
  });

  it('another org (another memo) reads its own', async () => {
    due.inFlightDeliveries.mockResolvedValue({ deliveries: [], capped: false });
    await sharedInFlightDeliveries({ ctx, now, memo: createOrgTickMemo() }, tx);
    await sharedInFlightDeliveries({ ctx, now, memo: createOrgTickMemo() }, tx);
    expect(due.inFlightDeliveries).toHaveBeenCalledTimes(2);
  });
});
