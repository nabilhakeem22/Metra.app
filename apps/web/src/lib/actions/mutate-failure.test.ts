import { DrizzleQueryError } from 'drizzle-orm/errors';
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

/**
 * What drizzle-orm >= 0.44 throws for a statement the ORM ran: the driver's
 * error on `.cause`, under a wrapper whose message is the SQL and its bound
 * PARAMETERS and which never sets its own `name`.
 */
function wrapped(driverError: Record<string, unknown>): Error {
  return Object.assign(
    new Error(
      'Failed query: insert into public.clients (org_id, phone) values ($1, $2)\n' +
        'params: org-uuid,01000000000',
    ),
    { query: 'insert into public.clients …', params: ['org-uuid', '01000000000'] },
    { cause: driverError },
  );
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

  it('maps a drizzle-WRAPPED failure exactly as it maps a bare one', async () => {
    // From drizzle-orm 0.44 a statement the ORM ran arrives as a wrapper with
    // the driver's error on `.cause`. Every branch of this mapping has to see
    // through it, or a lock timeout stops being `uncertain` and a named race
    // stops being named.
    await expect(rejectWith(wrapped({ code: '55P03' }))).resolves.toEqual({
      ok: false,
      error: 'uncertain',
    });
    await expect(
      rejectWith(
        wrapped({
          code: '23505',
          constraint_name: 'contracts_org_id_source_proposal_unique',
        }),
        CONTRACT_RACE,
      ),
    ).resolves.toEqual({ ok: false, error: 'contract_exists' });
    await expect(
      rejectWith(wrapped({ code: 'MT100' }), { immutableCode: 'proposal_not_draft' }),
    ).resolves.toEqual({ ok: false, error: 'proposal_not_draft' });
  });

  it("logs the DRIVER error's whitelist, never the wrapper that carries the params", async () => {
    // THE LEAK THIS CLOSES. A DrizzleQueryError never sets `name` (so it reads
    // 'Error') and its `message` is `Failed query: <sql>\nparams: <the bound
    // parameters>` — the colliding row's values by a second route. Reading the
    // whitelist field by field down the chain would take `constraint_name` off
    // the driver error and `message` off the wrapper, and write the phone
    // number into the Worker log.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      rejectWith(
        wrapped({
          name: 'PostgresError',
          code: '23505',
          constraint_name: 'clients_org_id_phone_unique',
          table_name: 'clients',
          message: 'duplicate key value violates unique constraint',
          detail: 'Key (org_id, phone)=(…, 01000000000) already exists.',
        }),
      ),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(logged).toHaveBeenCalledWith('mutateInOrg failed:', {
      name: 'PostgresError',
      code: '23505',
      constraint_name: 'clients_org_id_phone_unique',
      table_name: 'clients',
      message: 'duplicate key value violates unique constraint',
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('01000000000');
    logged.mockRestore();
  });

  it('falls back to the thrown value when it is a PLAIN error with no SQLSTATE', async () => {
    // Unchanged, and it is the only fallback shape whose own fields are safe to
    // read: nobody put a query into a TypeError.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      rejectWith(Object.assign(new Error('socket hang up'), { name: 'TypeError' })),
    ).resolves.toEqual({ ok: false, error: 'generic' });
    expect(logged).toHaveBeenCalledWith('mutateInOrg failed:', {
      name: 'TypeError',
      message: 'socket hang up',
    });
    logged.mockRestore();
  });

  describe('a DrizzleQueryError with no SQLSTATE under it (S1)', () => {
    // THE FALLBACK LEAK. `driverErrorOf` protects the path where the cause
    // carries a code; these are the paths where it does not, and until now they
    // fell through to `{ name, message }` — and a DrizzleQueryError's message IS
    // `Failed query: <sql>\nparams: <values>`. Built with the REAL constructor
    // out of drizzle-orm, not a hand-made lookalike, so the marker this depends
    // on is the one the library actually sets.
    const QUERY =
      'insert into "clients" ("org_id","email","phone","name_ar") values ($1,$2,$3,$4)';
    const PARAMS = ['org-uuid', 'victim@example.com', '+201001234567', 'أحمد المصري'];

    const loggedObject = (spy: ReturnType<typeof vi.spyOn>) =>
      spy.mock.calls.at(-1)?.[1] as Record<string, string>;

    /** Nothing a bound parameter, a row or a statement could have put there. */
    function expectNoRowValues(spy: ReturnType<typeof vi.spyOn>) {
      const printed = JSON.stringify(spy.mock.calls);
      for (const leak of [...PARAMS, 'Failed query', 'insert into', 'params:']) {
        expect(printed).not.toContain(leak);
      }
      expect(printed).not.toContain('already exists');
    }

    it('logs what it IS, not what it carries, when the cause has no code', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      // postgres.js raises this bare Error when the socket dies mid-statement.
      const thrown = new DrizzleQueryError(
        QUERY,
        PARAMS,
        new Error('Network connection lost.'),
      );
      await expect(rejectWith(thrown)).resolves.toEqual({
        ok: false,
        error: 'generic',
      });
      expect(loggedObject(logged)).toEqual({
        name: 'Error',
        thrown: 'DrizzleQueryError',
      });
      expectNoRowValues(logged);
      logged.mockRestore();
    });

    it('does the same when the driver error carries `code: undefined`', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cause = Object.assign(new Error('write CONNECTION_CLOSED'), {
        code: undefined,
        detail: 'Key (org_id, email)=(o, victim@example.com) already exists.',
      });
      await rejectWith(new DrizzleQueryError(QUERY, PARAMS, cause));
      expect(loggedObject(logged)).toEqual({
        name: 'Error',
        thrown: 'DrizzleQueryError',
      });
      expect(loggedObject(logged)).not.toHaveProperty('detail');
      expectNoRowValues(logged);
      logged.mockRestore();
    });

    it('does the same when the cause chain is a CYCLE the walk had to abandon', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const thrown = new DrizzleQueryError(QUERY, PARAMS, new Error('looped'));
      // The cause points back at the wrapper: the visited-set stops the walk
      // before it ever reaches a SQLSTATE, so `driverErrorOf` answers undefined.
      (thrown.cause as { cause?: unknown }).cause = thrown;
      await rejectWith(thrown);
      expect(loggedObject(logged)).toEqual({
        name: 'Error',
        thrown: 'DrizzleQueryError',
      });
      expectNoRowValues(logged);
      logged.mockRestore();
    });

    it('still prefers the DRIVER error when the cause does carry a SQLSTATE', async () => {
      // The guard must not swallow the useful case: a wrapped 23505 still logs
      // the five whitelisted fields off the PostgresError beneath it.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cause = Object.assign(new Error('duplicate key value'), {
        name: 'PostgresError',
        code: '23505',
        constraint_name: 'clients_org_id_email_unique',
        table_name: 'clients',
        detail: 'Key (org_id, email)=(o, victim@example.com) already exists.',
      });
      await rejectWith(new DrizzleQueryError(QUERY, PARAMS, cause));
      expect(loggedObject(logged)).toEqual({
        name: 'PostgresError',
        code: '23505',
        constraint_name: 'clients_org_id_email_unique',
        table_name: 'clients',
        message: 'duplicate key value',
      });
      expectNoRowValues(logged);
      logged.mockRestore();
    });
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
