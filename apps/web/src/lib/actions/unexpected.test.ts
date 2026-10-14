import { afterEach, describe, expect, it, vi } from 'vitest';
import { invariant } from './invariant';
import { unexpectedFailure } from './unexpected';

vi.mock('server-only', () => ({}));

const REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

afterEach(() => vi.restoreAllMocks());

describe('unexpectedFailure', () => {
  it('answers generic with a reference, and logs that reference with a whitelist', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const thrown = Object.assign(new Error('Failed query: select ... params: a@b.co'), {
      query: 'select ...',
      params: ['a@b.co'],
    });
    const result = unexpectedFailure('invite: send failed', thrown);
    expect(result).toEqual({ ok: false, error: 'generic', reference: expect.stringMatching(REFERENCE) });
    expect(logged).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('invite: send failed', {
      reference: result.reference,
      failure: { name: 'Error', thrown: 'DrizzleQueryError' },
    });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('a@b.co');
  });

  it('still logs a line when there is no caught value', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = unexpectedFailure('origin: no request origin');
    expect(logged).toHaveBeenCalledWith('origin: no request origin', {
      reference: result.reference,
      failure: { thrown: 'undefined' },
    });
  });
});

describe('invariant', () => {
  it('passes a truthy condition and throws the developer label otherwise', () => {
    expect(() => invariant(1, 'never')).not.toThrow();
    expect(() => invariant(undefined, 'claim row vanished under its lock')).toThrow(
      new Error('claim row vanished under its lock'),
    );
  });
});
