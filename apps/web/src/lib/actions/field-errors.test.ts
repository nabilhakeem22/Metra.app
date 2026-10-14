import { describe, expect, it } from 'vitest';
import { failFields, fieldsFailed, hasFieldErrors } from './field-errors';
import { ActionError, err, fail } from './result';

describe('field errors', () => {
  it('fieldsFailed answers check_fields with every field at once', () => {
    expect(
      fieldsFailed({
        phone: { code: 'phone_required' },
        notes: { code: 'too_long', params: { max: 2000 } },
      }),
    ).toEqual({
      ok: false,
      error: 'check_fields',
      fields: {
        phone: { code: 'phone_required' },
        notes: { code: 'too_long', params: { max: 2000 } },
      },
    });
  });

  it('refuses an empty map: "fix the fields" with nothing under any field', () => {
    expect(() => fieldsFailed({})).toThrow('fieldsFailed: empty');
    expect(() => failFields({})).toThrow('fieldsFailed: empty');
  });

  it('failFields throws an ActionError that carries the fields', () => {
    try {
      failFields({ email: { code: 'email_format' } });
      expect.unreachable();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ActionError);
      expect((thrown as ActionError).code).toBe('check_fields');
      expect((thrown as ActionError).detail).toEqual({
        fields: { email: { code: 'email_format' } },
      });
    }
  });

  it('hasFieldErrors is false only for an empty map', () => {
    expect(hasFieldErrors({})).toBe(false);
    expect(hasFieldErrors({ name: { code: 'name_required' } })).toBe(true);
  });

  it('err and fail carry message params when given, and only then', () => {
    expect(err('forbidden')).toEqual({ ok: false, error: 'forbidden' });
    expect(err('too_many_lines', { max: 500 })).toEqual({
      ok: false,
      error: 'too_many_lines',
      params: { max: 500 },
    });
    try {
      fail('too_many_lines', { max: 500 });
    } catch (thrown) {
      expect((thrown as ActionError).detail).toEqual({ params: { max: 500 } });
    }
    expect(() => fail('forbidden')).toThrow(
      expect.objectContaining({ code: 'forbidden', detail: undefined }),
    );
  });

  it('keeps check_fields for the builders that carry the fields (tsc)', () => {
    // @ts-expect-error check_fields without fields would say "fix the fields" with nothing under any.
    expect(err('check_fields')).toEqual({ ok: false, error: 'check_fields' });
    // @ts-expect-error same for the thrown form.
    expect(() => fail('check_fields')).toThrow(ActionError);
  });
});
