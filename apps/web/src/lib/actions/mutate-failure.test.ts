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

type MutateOptions = Parameters<typeof mutateInOrg>[1];

/** Every mutation rejects the same way here — the thrown value and the options
 *  are what differ. */
function rejectWith(thrown: unknown, opts: MutateOptions = {}) {
  openTransaction.mockRejectedValueOnce(thrown);
  return mutateInOrg(ctx, opts, async () => undefined);
}

const CONTRACT_RACE: MutateOptions = {
  conflict: {
    constraint: 'contracts_org_id_source_proposal_unique',
    code: 'contract_exists',
  },
};

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

  it('names a 23505 only when the CONSTRAINT is the one the caller named', async () => {
    await expect(
      rejectWith(
        { code: '23505', constraint_name: 'contracts_org_id_source_proposal_unique' },
        CONTRACT_RACE,
      ),
    ).resolves.toEqual({ ok: false, error: 'contract_exists' });
  });

  it('leaves ANOTHER constraint\'s 23505 in the tail — generic, and LOGGED', async () => {
    // The finding this closes: `generateContractCore` runs five phases in one
    // transaction. A collision on contracts_org_id_number_unique means the
    // number allocator failed, and the bare-code version answered it "a contract
    // already exists" while removing the only record that it happened.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      rejectWith(
        { code: '23505', constraint_name: 'contracts_org_id_number_unique' },
        CONTRACT_RACE,
      ),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('leaves an UNATTRIBUTED 23505 in the tail too', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(rejectWith({ code: '23505' }, CONTRACT_RACE)).resolves.toEqual({
      ok: false,
      error: 'generic',
    });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('leaves every 23505 in the tail when the mutation named no race at all', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      rejectWith({ code: '23505', constraint_name: 'clients_org_id_phone_unique' }),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('still answers an MT100 with the immutable code, which names no constraint', async () => {
    // MT100 is raised by `enforce_immutable_when`, a TRIGGER: the server
    // attributes it to no constraint, so `immutableCode` stays a bare code.
    await expect(
      rejectWith({ code: 'MT100' }, { immutableCode: 'proposal_not_draft' }),
    ).resolves.toEqual({ ok: false, error: 'proposal_not_draft' });
  });

  it('logs a WHITELIST of the failure, never the error object', async () => {
    // postgres.js Object.assigns every server field onto the error, ENUMERABLE,
    // and for a 23505 `detail` carries the colliding row's key values. The log
    // line must describe the SHAPE of the failure and nothing about the row.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      rejectWith({
        name: 'PostgresError',
        code: '23505',
        constraint_name: 'clients_org_id_phone_unique',
        table_name: 'clients',
        message: 'duplicate key value violates unique constraint',
        detail: 'Key (org_id, phone)=(…, 01000000000) already exists.',
        where: 'PL/pgSQL function do_something() line 3',
        schema_name: 'public',
      }),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(logged).toHaveBeenCalledWith('mutateInOrg failed:', {
      name: 'PostgresError',
      code: '23505',
      constraint_name: 'clients_org_id_phone_unique',
      table_name: 'clients',
      message: 'duplicate key value violates unique constraint',
    });
    logged.mockRestore();
  });

  it('drops a non-string field rather than passing the value through', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rejectWith({
      code: '42703',
      message: 'column "nope" does not exist',
      constraint_name: { toString: () => 'not a string' },
      table_name: '',
    });
    expect(logged).toHaveBeenCalledWith('mutateInOrg failed:', {
      code: '42703',
      message: 'column "nope" does not exist',
    });
    logged.mockRestore();
  });

  it('says what it got when a non-object was thrown', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await rejectWith('just a string');
    expect(logged).toHaveBeenCalledWith('mutateInOrg failed:', { thrown: 'string' });
    logged.mockRestore();
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
