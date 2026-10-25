import { describe, expect, it } from 'vitest';
import { loginReturnOf, parseOtpSendRequest, parseOtpVerifyRequest } from './otp-contract';

// The sign-in endpoints' request shapes: null means 400 malformed. The parsers
// check shape only; the rules a person can fix (an empty box, a bad address, a
// short code) are the core's, answered under the box as before.

describe('parseOtpSendRequest', () => {
  it('keeps the channel and the identifier as typed, and nothing else', () => {
    expect(parseOtpSendRequest({ channel: 'email', identifier: ' Mona@Firm.example ', extra: 1 })).toEqual({
      channel: 'email',
      identifier: ' Mona@Firm.example ',
    });
    expect(parseOtpSendRequest({ channel: 'phone', identifier: '' })).toEqual({ channel: 'phone', identifier: '' });
  });

  it.each([
    ['null', null],
    ['a string', 'email'],
    ['an array', ['email', 'x']],
    ['an unknown channel', { channel: 'fax', identifier: 'x' }],
    ['a missing identifier', { channel: 'email' }],
    ['a numeric identifier', { channel: 'phone', identifier: 201001234567 }],
    ['an identifier of 321 characters', { channel: 'email', identifier: 'a'.repeat(321) }],
  ])('refuses %s', (_case, body) => {
    expect(parseOtpSendRequest(body)).toBeNull();
  });

  it('accepts an identifier of exactly 320 characters', () => {
    expect(parseOtpSendRequest({ channel: 'email', identifier: 'a'.repeat(320) })).not.toBeNull();
  });
});

describe('parseOtpVerifyRequest', () => {
  it('keeps the channel, the identifier and the token', () => {
    expect(parseOtpVerifyRequest({ channel: 'email', identifier: 'mona@firm.example', token: '123456' })).toEqual({
      channel: 'email',
      identifier: 'mona@firm.example',
      token: '123456',
    });
  });

  it("keeps a return of 'site', the site app's login link", () => {
    expect(parseOtpVerifyRequest({ channel: 'phone', identifier: '+201001234567', token: '123456', return: 'site' })).toEqual({
      channel: 'phone',
      identifier: '+201001234567',
      token: '123456',
      return: 'site',
    });
  });

  it.each([
    ['an unknown return', { channel: 'email', identifier: 'x', token: '123456', return: 'dashboard' }],
    ['a null return', { channel: 'email', identifier: 'x', token: '123456', return: null }],
    ['a missing token', { channel: 'email', identifier: 'x' }],
    ['a numeric token', { channel: 'email', identifier: 'x', token: 123456 }],
    ['a token of 17 characters', { channel: 'email', identifier: 'x', token: '1'.repeat(17) }],
    ['a bad send part', { channel: 'fax', identifier: 'x', token: '123456' }],
  ])('refuses %s', (_case, body) => {
    expect(parseOtpVerifyRequest(body)).toBeNull();
  });
});

describe('loginReturnOf', () => {
  it("is 'site' for 'site' only", () => {
    expect(loginReturnOf('site')).toBe('site');
    for (const value of [null, undefined, '', 'SITE', 'dashboard', ['site']]) expect(loginReturnOf(value), String(value)).toBeUndefined();
  });
});
