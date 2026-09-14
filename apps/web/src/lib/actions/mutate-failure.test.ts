import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { DbWriteUncertainError } from '@/lib/db/client';
import { ActionError } from './result';
import { mutateInOrg } from './mutate';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/context', () => ({ withOrgContext: vi.fn() }));

// What mutateInOrg answers when the transaction throws. The mapping is the
// contract the cockpit's retry rule reads: only a coded refusal may drop a held
// idempotency key, so an AMBIGUOUS Postgres failure must not arrive as 'generic'.

const ctx = { orgId: 'o1', userId: 'u1', role: 'owner' } as unknown as OrgContext;
const openTransaction = vi.mocked(withOrgContext);

/** Every mutation rejects the same way here — only the thrown value differs. */
function rejectWith(thrown: unknown) {
  openTransaction.mockRejectedValueOnce(thrown);
  return mutateInOrg(ctx, {}, async () => undefined);
}

describe('mutateInOrg failure mapping', () => {
  beforeEach(() => {
    openTransaction.mockReset();
  });

  it('maps a lock timeout (55P03) to uncertain, not generic', async () => {
    // The retry path's own hazard: attempt #1 is abandoned but still holds the
    // self-loop row lock, attempt #2 waits, lock_timeout fires. Attempt #1 may
    // yet COMMIT, so the key must be held.
    await expect(rejectWith({ code: '55P03' })).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
  });

  it('maps a cancelled statement and a dropped connection to uncertain', async () => {
    await expect(rejectWith({ code: '57014' })).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
    await expect(rejectWith({ code: '08006' })).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
  });

  it('still maps a write deadline to uncertain', async () => {
    await expect(rejectWith(new DbWriteUncertainError())).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
  });

  it('still answers a coded refusal with its own code', async () => {
    await expect(rejectWith(new ActionError('illegal_trigger'))).resolves.toEqual({
      ok: false,
      error: 'illegal_trigger',
    });
  });

  it('keeps generic for a failure it cannot classify', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(rejectWith(new Error('boom'))).resolves.toEqual({
      ok: false,
      error: 'generic',
    });
    // A definite refusal is silent; an unclassified failure must leave a trace.
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
