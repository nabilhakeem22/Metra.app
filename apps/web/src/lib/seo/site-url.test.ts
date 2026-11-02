import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSiteUrl } from './site-url';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getSiteUrl', () => {
  it('uses NEXT_PUBLIC_APP_URL, trimmed and without trailing slashes', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '  https://metra.example//  ');
    expect(getSiteUrl()).toBe('https://metra.example');
  });

  it.each([[''], ['   ']])('falls back to local dev when the variable is blank (%j)', (value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value);
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });

  it('falls back to local dev when the variable is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
    expect(getSiteUrl()).toBe('http://localhost:3000');
  });
});
