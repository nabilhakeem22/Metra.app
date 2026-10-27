import { inspect } from 'node:util';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { driverRefusalOf, sqlstateOf } from '@metra/db/sqlstate';
import { describe, expect, it } from 'vitest';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { ActionError } from '@/lib/actions/result';
import { RedactedDatabaseError, throwRedactedDatabaseFailure } from './redacted-failure';

const EMAIL = 'someone@example.com';
const SQL_TEXT = 'insert into "client_contacts" ("email") values ($1)';

/** What postgres.js throws: the server's ErrorResponse copied onto an Error. */
function postgresError(fields: Record<string, string>, message: string): Error {
  return Object.assign(new Error(message), { name: 'PostgresError', severity: 'ERROR', ...fields });
}

const uniqueViolation = postgresError(
  {
    code: '23505',
    constraint_name: 'client_contacts_org_email_unique',
    table_name: 'client_contacts',
    detail: `Key (org_id, email)=(o, ${EMAIL}) already exists.`,
  },
  'duplicate key value violates unique constraint "client_contacts_org_email_unique"',
);

/** The value the redactor throws in place of `error`. */
function rethrown(error: unknown): unknown {
  try {
    throwRedactedDatabaseFailure(error);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('throwRedactedDatabaseFailure returned');
}

describe('throwRedactedDatabaseFailure', () => {
  const wrapped = new DrizzleQueryError(SQL_TEXT, [EMAIL], uniqueViolation);

  it('prints no query, no params and no detail where Next prints the thrown value', () => {
    const printed = inspect(rethrown(wrapped), { depth: 10 });
    expect(printed).not.toContain(EMAIL);
    expect(printed).not.toContain('client_contacts" ("email")');
    expect(printed).not.toContain('Failed query');
    expect(printed).toContain("code: '23505'");
  });

  it('keeps the SQLSTATE and constraint every caller maps, off the same object', () => {
    const redacted = rethrown(wrapped);
    expect(redacted).toBeInstanceOf(RedactedDatabaseError);
    expect(sqlstateOf(redacted)).toBe('23505');
    expect(driverRefusalOf(redacted)).toEqual({
      code: '23505',
      constraintName: 'client_contacts_org_email_unique',
    });
    expect(redacted).not.toHaveProperty('cause');
    expect(redacted).not.toHaveProperty('params');
  });

  it('logs through loggableFailure exactly what the original did', () => {
    expect(loggableFailure(rethrown(wrapped))).toEqual(loggableFailure(wrapped));
    expect(loggableFailure(rethrown(uniqueViolation))).toEqual(loggableFailure(uniqueViolation));
  });

  it('drops the message of a data exception, which echoes the value', () => {
    const dataException = postgresError({ code: '22P02' }, `invalid input syntax for type uuid: "${EMAIL}"`);
    const redacted = rethrown(new DrizzleQueryError('select 1', [EMAIL], dataException));
    expect(inspect(redacted)).not.toContain(EMAIL);
    expect(sqlstateOf(redacted)).toBe('22P02');
  });

  it('redacts a wrapper whose cause carries no SQLSTATE', () => {
    const redacted = rethrown(new DrizzleQueryError(SQL_TEXT, [EMAIL], new TypeError(EMAIL)));
    expect(inspect(redacted, { depth: 10 })).not.toContain(EMAIL);
    expect(sqlstateOf(redacted)).toBeUndefined();
  });

  it('passes an app error and a plain error through as the same object', () => {
    for (const own of [new ActionError('flow_not_enabled'), new Error('db-operation-deadline'), new TypeError('x')]) {
      expect(rethrown(own)).toBe(own);
    }
    expect(rethrown('just a string')).toBe('just a string');
  });

  it('treats a value that throws when asked what it carries as a database failure', () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('exploded');
        },
      },
    );
    expect(rethrown(hostile)).toBeInstanceOf(RedactedDatabaseError);
  });
});
