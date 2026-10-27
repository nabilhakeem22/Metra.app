import { describe, expect, it } from 'vitest';
import { isAllowedRenderRequest, requestSchemeOf } from './render-request-policy';

describe('isAllowedRenderRequest', () => {
  it.each(['data:font/ttf;base64,AA', 'about:blank'])('allows %s', (url) => {
    expect(isAllowedRenderRequest(url)).toBe(true);
  });

  it.each([
    'https://x',
    'http://localhost',
    'file:///etc/passwd',
    'blob:x',
    'ws://x',
    'https://metra-web.nabil-hakeem22.workers.dev/en/dashboard',
  ])('refuses %s', (url) => {
    expect(isAllowedRenderRequest(url)).toBe(false);
  });
});

describe('requestSchemeOf', () => {
  it('keeps the scheme and nothing else', () => {
    expect(requestSchemeOf('https://storage.test/object/sign/x?token=SECRET')).toBe('https');
    expect(requestSchemeOf('FILE:///etc/passwd')).toBe('file');
  });

  it('names a URL without a scheme unknown', () => {
    expect(requestSchemeOf('//x/y')).toBe('unknown');
  });
});
