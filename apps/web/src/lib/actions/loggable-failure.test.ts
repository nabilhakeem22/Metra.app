import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { loggableFailure } from './loggable-failure';

/** What postgres.js throws: the server's ErrorResponse copied onto an Error. */
function postgresError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    name: 'PostgresError',
    ...fields,
  });
}

describe('loggableFailure', () => {
  it('copies the five whitelisted fields off the driver error and nothing else', () => {
    expect(
      loggableFailure(
        postgresError({
          code: '23505',
          constraint_name: 'clients_org_id_phone_unique',
          table_name: 'clients',
          detail: 'Key (org_id, phone)=(o, 01000000000) already exists.',
          schema_name: 'public',
          where: 'PL/pgSQL function do_something() line 3',
        }),
      ),
    ).toEqual({
      name: 'PostgresError',
      code: '23505',
      constraint_name: 'clients_org_id_phone_unique',
      table_name: 'clients',
      message: 'duplicate key value violates unique constraint',
    });
  });

  it('reads a plain error directly — nobody put a query into a TypeError', () => {
    expect(loggableFailure(new TypeError('cannot read properties of undefined'))).toEqual(
      { name: 'TypeError', message: 'cannot read properties of undefined' },
    );
  });

  it('says what it got when a non-object was thrown', () => {
    expect(loggableFailure('just a string')).toEqual({ thrown: 'string' });
    expect(loggableFailure(null)).toEqual({ thrown: 'object' });
    expect(loggableFailure(undefined)).toEqual({ thrown: 'undefined' });
  });

  /**
   * The public token surfaces are the app's only unauthenticated entry point,
   * and the ONE argument they pass to a SECURITY DEFINER function is the share
   * token's sha256 hash. From drizzle 0.44 that argument is on the thrown
   * error's `params` and inside its message, so every `catch` on those paths is
   * one `console.error(label, e)` away from writing an identified client's
   * share-link hash into Workers Logs (S4).
   */
  describe('the share-token hash never reaches the log', () => {
    const HASH = 'a'.repeat(64);
    const sdfThrow = (cause: unknown) =>
      new DrizzleQueryError(
        'select public.app_delivery_by_token($1) as data',
        [HASH],
        cause as Error,
      );

    it('keeps it out when the SDF call fails with a SQLSTATE under it', () => {
      const logged = loggableFailure(
        sdfThrow(postgresError({ code: '57014', message: 'canceling statement' })),
      );
      expect(JSON.stringify(logged)).not.toContain(HASH);
      expect(logged).toEqual({
        name: 'PostgresError',
        code: '57014',
        message: 'canceling statement',
      });
    });

    it('keeps it out when the SDF call fails with NO SQLSTATE under it', () => {
      // The fallback branch: a dropped socket mid-statement. This is the shape
      // that leaked before S1, and it is the likelier one on a database blip —
      // which is the exact event this breadcrumb exists for.
      const logged = loggableFailure(sdfThrow(new Error('Network connection lost.')));
      expect(JSON.stringify(logged)).not.toContain(HASH);
      expect(logged).toEqual({ name: 'Error', thrown: 'DrizzleQueryError' });
    });

    it('proves the RAW error would have leaked it, both ways console prints', () => {
      // Not a hypothetical. The control for both cases above.
      const raw = sdfThrow(new Error('Network connection lost.'));
      expect(raw.message).toContain(HASH);
      expect(JSON.stringify(raw)).toContain(HASH);
    });
  });
});
