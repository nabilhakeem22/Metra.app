import { describe, expect, it } from 'vitest';
import { inviteFieldErrors } from './invite-field-rules';

describe('inviteFieldErrors', () => {
  it('asks for an address, then a well-formed one, then one within the cap', () => {
    expect(inviteFieldErrors({ email: '   ' })).toEqual({ email: { code: 'required' } });
    expect(inviteFieldErrors({ email: 'mona@' })).toEqual({ email: { code: 'email_format' } });
    expect(inviteFieldErrors({ email: `${'a'.repeat(250)}@x.co` })).toEqual({
      email: { code: 'too_long', params: { max: 254 } },
    });
    expect(inviteFieldErrors({ email: ' Mona@Example.com ' })).toEqual({});
  });
});
