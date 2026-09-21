import { describe, expect, it } from 'vitest';
import { driverErrorOf, pgFieldOf, sqlstateOf } from './sqlstate';

/** What postgres.js throws: every ErrorResponse field copied onto an Error. */
function postgresError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    name: 'PostgresError',
    ...fields,
  });
}

/**
 * What drizzle-orm >= 0.44 throws instead: an Error whose message is the
 * generated SQL and its PARAMETERS, and whose `cause` is the driver's error.
 * Reproduced field-for-field from node_modules/drizzle-orm/errors.js — it sets
 * `query`, `params` and `cause`, and never touches `name`.
 */
function drizzleQueryError(query: string, params: unknown[], cause: unknown): Error {
  return Object.assign(new Error(`Failed query: ${query}\nparams: ${String(params)}`), {
    query,
    params,
    cause,
  });
}

describe('sqlstateOf', () => {
  it('reads a SQLSTATE sitting at the top level (the bare driver error)', () => {
    // Every statement postgres.js runs on its own still throws this shape:
    // BEGIN/COMMIT inside a drizzle transaction, sql.unsafe in the isolation
    // gate, and the driver's own connection errors.
    expect(sqlstateOf(postgresError({ code: '23505' }))).toBe('23505');
    expect(sqlstateOf({ code: 'MT100' })).toBe('MT100');
    expect(sqlstateOf({ code: 'CONNECTION_CLOSED' })).toBe('CONNECTION_CLOSED');
  });

  it('reads it through a DrizzleQueryError wrapper', () => {
    const wrapped = drizzleQueryError(
      'insert into public.contracts (id, org_id) values ($1, $2)',
      ['…', '…'],
      postgresError({ code: '23503', constraint_name: 'contracts_org_client_fk' }),
    );
    expect(sqlstateOf(wrapped)).toBe('23503');
    expect(pgFieldOf(wrapped, 'constraint_name')).toBe('contracts_org_client_fk');
  });

  it('reads it through a chain of wrappers', () => {
    expect(sqlstateOf({ cause: { cause: { code: '55P03' } } })).toBe('55P03');
  });

  it('takes the OUTERMOST level that has one', () => {
    // A wrapper that carries its own code is answered for, not walked past:
    // the outer error is the one that was actually thrown at the caller.
    expect(sqlstateOf({ code: '57014', cause: { code: '23505' } })).toBe('57014');
  });

  it('is undefined when no level carries a usable SQLSTATE', () => {
    expect(sqlstateOf(new Error('boom'))).toBeUndefined();
    expect(sqlstateOf({ code: 23505 })).toBeUndefined();
    expect(sqlstateOf({ code: '' })).toBeUndefined();
    expect(sqlstateOf({ cause: { code: null } })).toBeUndefined();
  });

  it('is undefined for anything that is not an object', () => {
    expect(sqlstateOf(null)).toBeUndefined();
    expect(sqlstateOf(undefined)).toBeUndefined();
    expect(sqlstateOf('23505')).toBeUndefined();
    expect(sqlstateOf(23505)).toBeUndefined();
  });

  it('skips a level whose field is the wrong type rather than stopping there', () => {
    expect(sqlstateOf({ code: 42, cause: { code: '23514' } })).toBe('23514');
  });

  it('terminates on a cause that points back into the chain', () => {
    const outer: Record<string, unknown> = { name: 'outer' };
    const inner: Record<string, unknown> = { code: 'MT100', cause: outer };
    outer.cause = inner;
    expect(sqlstateOf(outer)).toBe('MT100');

    const selfReferential: Record<string, unknown> = {};
    selfReferential.cause = selfReferential;
    expect(sqlstateOf(selfReferential)).toBeUndefined();
  });

  it('stops after a bounded number of levels', () => {
    // 8 levels of headroom against a live chain of 2. A SQLSTATE buried deeper
    // than that is not a wrapped query error, it is a runaway.
    let deep: Record<string, unknown> = { code: '23505' };
    for (let i = 0; i < 20; i += 1) deep = { cause: deep };
    expect(sqlstateOf(deep)).toBeUndefined();
  });
});

describe('pgFieldOf', () => {
  it('reads a constraint name off an error that carries no SQLSTATE at all', () => {
    // isUniqueViolationOf composes the two reads, so this one must not depend
    // on the other having succeeded.
    expect(pgFieldOf({ constraint_name: 'clients_org_id_phone_unique' }, 'constraint_name'))
      .toBe('clients_org_id_phone_unique');
  });

  it('is undefined for an absent, empty or non-string field', () => {
    expect(pgFieldOf({ code: '23505' }, 'constraint_name')).toBeUndefined();
    expect(pgFieldOf({ constraint_name: '' }, 'constraint_name')).toBeUndefined();
    expect(pgFieldOf({ constraint_name: 7 }, 'constraint_name')).toBeUndefined();
    expect(pgFieldOf(null, 'constraint_name')).toBeUndefined();
  });
});

describe('driverErrorOf', () => {
  it('returns the level the DRIVER threw, not the ORM wrapper around it', () => {
    const driver = postgresError({
      code: '23505',
      constraint_name: 'clients_org_id_phone_unique',
      table_name: 'clients',
      detail: 'Key (org_id, phone)=(…, 01000000000) already exists.',
    });
    const wrapped = drizzleQueryError(
      'insert into public.clients (org_id, phone) values ($1, $2)',
      ['…', '01000000000'],
      driver,
    );
    expect(driverErrorOf(wrapped)).toBe(driver);
  });

  it('is what keeps the wrapper\'s message — which carries the PARAMETERS — out of a whitelist read', () => {
    // The hazard this function exists for. DrizzleQueryError never sets `name`,
    // so it inherits 'Error', and its `message` is the SQL plus the bound
    // parameter values. Reading a log whitelist field-by-field down the chain
    // would take `message` from the wrapper and log the row.
    const wrapped = drizzleQueryError(
      'insert into public.clients (org_id, phone) values ($1, $2)',
      ['org-uuid', '01000000000'],
      postgresError({ code: '23505' }),
    );
    expect(wrapped.name).toBe('Error');
    expect(wrapped.message).toContain('01000000000');
    expect(driverErrorOf(wrapped)?.name).toBe('PostgresError');
    expect(String(driverErrorOf(wrapped)?.message)).not.toContain('01000000000');
  });

  it('is undefined when nothing in the chain carries a SQLSTATE', () => {
    expect(driverErrorOf(new Error('boom'))).toBeUndefined();
    expect(driverErrorOf('just a string')).toBeUndefined();
    expect(driverErrorOf(null)).toBeUndefined();
  });
});
