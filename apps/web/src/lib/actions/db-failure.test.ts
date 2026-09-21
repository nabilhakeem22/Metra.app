import { describe, expect, it } from 'vitest';
import { isAmbiguousDbOutcome } from './db-failure';

// postgres.js copies the server's SQLSTATE onto `error.code` as a string.
const pgError = (code: string) => Object.assign(new Error(code), { code });

/**
 * What drizzle-orm >= 0.44 throws for a statement the ORM ran: the driver's
 * error on `.cause`, under a wrapper carrying the SQL and its parameters.
 */
const wrappedPgError = (code: string) =>
  Object.assign(new Error('Failed query: update public.proposals …\nparams: …'), {
    cause: pgError(code),
  });

describe('isAmbiguousDbOutcome', () => {
  it('is true for a lock timeout — the lock holder may be the attempt being retried', () => {
    expect(isAmbiguousDbOutcome(pgError('55P03'))).toBe(true);
  });

  it('is true for a cancelled statement and for every connection exception', () => {
    expect(isAmbiguousDbOutcome(pgError('57014'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08000'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08006'))).toBe(true);
    expect(isAmbiguousDbOutcome(pgError('08P01'))).toBe(true);
  });

  it('is true for the codes postgres.js itself raises when the socket dies', () => {
    // A dropped connection never carries a server SQLSTATE; the driver's own
    // error factory sets these instead (node_modules/postgres/src/errors.js).
    for (const code of [
      'CONNECTION_CLOSED',
      'CONNECTION_DESTROYED',
      'CONNECTION_ENDED',
      'CONNECT_TIMEOUT',
    ]) {
      expect(isAmbiguousDbOutcome(pgError(code))).toBe(true);
    }
  });

  it("is true for Node's own socket codes, which surface below the driver (S5)", () => {
    // What a recycled pooler backend or a dropped Hyperdrive hop actually
    // produces. Unlisted these fell to `generic`, and `generic` is not a
    // DEFINITE_REFUSAL — so the cockpit released a held idempotency key on an
    // attempt that may have committed.
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']) {
      expect(isAmbiguousDbOutcome(pgError(code))).toBe(true);
      expect(isAmbiguousDbOutcome(wrappedPgError(code))).toBe(true);
    }
  });

  it('is true for a code carried only by an AggregateError member (S5)', () => {
    // One host, two addresses, both refused: Node puts the codes on `errors[]`
    // and leaves `cause` empty, so this is the shape a cause-only walk missed.
    const aggregate = new AggregateError(
      [pgError('ECONNREFUSED'), pgError('ECONNREFUSED')],
      'All connection attempts failed',
    );
    expect(isAmbiguousDbOutcome(aggregate)).toBe(true);
  });

  it('is FALSE for a refusal raised before anything was sent', () => {
    // postgres.js raises MAX_PARAMETERS_EXCEEDED before the statement leaves the
    // client, so nothing can have committed. Ambiguous is not a synonym for bad.
    expect(isAmbiguousDbOutcome(pgError('MAX_PARAMETERS_EXCEEDED'))).toBe(false);
  });

  it('is true for admin_shutdown, which a pooler raises when it recycles a backend', () => {
    expect(isAmbiguousDbOutcome(pgError('57P01'))).toBe(true);
  });

  it('is false for errors that definitively committed nothing', () => {
    expect(isAmbiguousDbOutcome(pgError('23505'))).toBe(false); // unique violation
    expect(isAmbiguousDbOutcome(pgError('23514'))).toBe(false); // check violation
    expect(isAmbiguousDbOutcome(pgError('42703'))).toBe(false); // undefined column
    // '08' as a prefix of a longer non-class-08 code cannot exist, but a code
    // that merely CONTAINS 08 must not match.
    expect(isAmbiguousDbOutcome(pgError('P0801'))).toBe(false);
  });

  it('answers the same when drizzle has wrapped the driver error', () => {
    // The whole hazard: `uncertain` is what makes the cockpit HOLD a live
    // idempotency key. A wrapped lock timeout read as "not ambiguous" would
    // become `generic`, the key would be dropped, and the retry would spend a
    // second free revision while the first attempt was still free to commit.
    expect(isAmbiguousDbOutcome(wrappedPgError('55P03'))).toBe(true);
    expect(isAmbiguousDbOutcome(wrappedPgError('57014'))).toBe(true);
    expect(isAmbiguousDbOutcome(wrappedPgError('57P01'))).toBe(true);
    expect(isAmbiguousDbOutcome(wrappedPgError('08006'))).toBe(true);
    expect(isAmbiguousDbOutcome(wrappedPgError('CONNECTION_CLOSED'))).toBe(true);
  });

  it('is still false for a wrapped error that committed nothing', () => {
    expect(isAmbiguousDbOutcome(wrappedPgError('23505'))).toBe(false);
    expect(isAmbiguousDbOutcome(wrappedPgError('MT100'))).toBe(false);
  });

  it('is false for the wrapper alone, which carries no SQLSTATE of its own', () => {
    expect(
      isAmbiguousDbOutcome(new Error('Failed query: select 1\nparams: ')),
    ).toBe(false);
  });

  it('is false for anything that is not a Postgres error', () => {
    expect(isAmbiguousDbOutcome(new Error('boom'))).toBe(false);
    expect(isAmbiguousDbOutcome(null)).toBe(false);
    expect(isAmbiguousDbOutcome(undefined)).toBe(false);
    expect(isAmbiguousDbOutcome('55P03')).toBe(false);
    expect(isAmbiguousDbOutcome({ code: 55103 })).toBe(false);
  });
});
