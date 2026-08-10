import { describe, expect, it } from 'vitest';
import { ActionError, err, fail, ok } from './result';

describe('action result', () => {
  it('ok() and err() build the flat shape', () => {
    expect(ok()).toEqual({ ok: true });
    expect(ok({ link: 'x', already: true })).toEqual({
      ok: true,
      link: 'x',
      already: true,
    });
    expect(err('forbidden')).toEqual({ ok: false, error: 'forbidden' });
  });

  it('fail() throws an ActionError carrying the code', () => {
    expect(() => fail('last_owner')).toThrow(ActionError);
    try {
      fail('immutable');
    } catch (e) {
      expect(e).toBeInstanceOf(ActionError);
      expect((e as ActionError).code).toBe('immutable');
      expect((e as ActionError).message).toBe('immutable');
    }
  });
});
