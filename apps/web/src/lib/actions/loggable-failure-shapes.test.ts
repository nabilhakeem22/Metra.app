import { DrizzleQueryError } from 'drizzle-orm/errors';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { answered } from '@/lib/share/portal-act-failure';
import { loggableFailure } from './loggable-failure';

// Round E S3 (the security tester's shapes, scratchpad e1-ts/r3-*.test.ts): the
// redactor answered() relies on never throws, and never logs a message off a
// node that carries the bound parameters, or wraps one that does.

vi.mock('server-only', () => ({}));

const HASH = 'SECRET-HASH-abc123';
const IP = '198.51.100.9';
const BODY = 'BODY-CANARY';
const PARAMS = [HASH, BODY, IP];
const PostgresError = (postgres as unknown as { PostgresError: new (fields: object) => Error }).PostgresError;
const pg = (code: string, message: string) => new PostgresError({ code, message, detail: `Key (x)=(${HASH})`, severity: 'ERROR' });
const wrapped = (cause: unknown) => new DrizzleQueryError('select f($1,$2,$3)', PARAMS, cause as Error);

const SHAPES: Array<[string, () => unknown]> = [
  ['drizzle around a 55P03', () => wrapped(pg('55P03', 'canceling statement due to lock timeout'))],
  ['drizzle around a TypeError', () => wrapped(new TypeError('socket hang up'))],
  ['an Error around drizzle around a 40P01', () => new Error('outer wrapper', { cause: wrapped(pg('40P01', 'deadlock detected')) })],
  ['an AggregateError of nine wrappers and a 55P03', () => new AggregateError([...Array(9)].map(() => wrapped(new TypeError('x'))).concat([wrapped(pg('55P03', 'lock'))]), 'agg')],
  ['a cause cycle', () => { const inner: Error & { cause?: unknown } = wrapped(new TypeError('x')); const outer = new Error('b', { cause: inner }); inner.cause = outer; return outer; }],
  ['a wrapper that also carries its own code', () => Object.assign(wrapped(new TypeError('x')), { code: 'XX000' })],
  ["an Error that copies the wrapper's message", () => { const inner = wrapped(new TypeError('x')); return new Error(inner.message, { cause: inner }); }],
  ['a Proxy that throws on every trap', () => new Proxy({}, { get() { throw new Error(HASH); }, has() { throw new Error(HASH); }, getOwnPropertyDescriptor() { throw new Error(HASH); } })],
  ['a Proxy whose getOwnPropertyDescriptor trap throws', () => new Proxy(new Error('m'), { getOwnPropertyDescriptor() { throw new Error(HASH); } })],
  ['a string', () => `failed with ${HASH}`],
  ['null', () => null],
];

describe('a failure of any shape, through answered()', () => {
  it.each(SHAPES)('%s: a failed-act answer, one line, no hash, IP or body', async (_label, make) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answer = await answered('act', (failure) => failure, async () => { throw make(); });
    expect(['uncertain', 'generic']).toContain((answer as { error: string }).error);
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls);
    for (const secret of [HASH, IP, BODY]) expect(line).not.toContain(secret);
    logged.mockRestore();
  });
});

describe('what the line keeps', () => {
  it("the driver's own text below a wrapper: the 55P03 and the server message", () => {
    expect(loggableFailure(wrapped(pg('55P03', 'canceling statement due to lock timeout')))).toMatchObject({
      code: '55P03',
      message: 'canceling statement due to lock timeout',
    });
  });

  it('a wrapper with its own code keeps the code, never the message', () => {
    const line = loggableFailure(Object.assign(wrapped(new TypeError('x')), { code: 'XX000' }));
    expect(line.code).toBe('XX000');
    expect(line.message).toBeUndefined();
  });
});

describe('a data exception never logs the value Postgres echoed (S1)', () => {
  it.each(['22P02', '22001', '22003', '22008', '22021'])('%s keeps its code, drops its message', (code) => {
    const failure = loggableFailure({
      name: 'PostgresError',
      code,
      message: 'invalid input syntax for type uuid: "someone@example.com"',
    });
    expect(failure).toEqual({ name: 'PostgresError', code });
    expect(JSON.stringify(failure)).not.toContain('someone@example.com');
  });
});
