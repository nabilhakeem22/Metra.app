import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteVerification } from './site-verification';

const GOOGLE = 'NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION';
const BING = 'NEXT_PUBLIC_BING_SITE_VERIFICATION';

afterEach(() => {
  vi.unstubAllEnvs();
});

function stub(google: string | undefined, bing: string | undefined): void {
  vi.stubEnv(GOOGLE, google);
  vi.stubEnv(BING, bing);
}

describe('siteVerification', () => {
  it.each<[string | undefined, string | undefined]>([
    [undefined, undefined],
    ['', ''],
    ['   ', '  '],
  ])('is absent when both variables are blank (%j, %j)', (google, bing) => {
    stub(google, bing);
    expect(siteVerification()).toBeUndefined();
  });

  it('gives the Google tag alone', () => {
    stub(' google_Token-123 ', undefined);
    expect(siteVerification()).toEqual({ google: 'google_Token-123' });
  });

  it('gives the Bing tag alone as msvalidate.01', () => {
    stub(undefined, 'ABCDEF0123456789');
    expect(siteVerification()).toEqual({ other: { 'msvalidate.01': 'ABCDEF0123456789' } });
  });

  it('gives both', () => {
    stub('google_Token-123', 'ABCDEF0123456789');
    expect(siteVerification()).toEqual({ google: 'google_Token-123', other: { 'msvalidate.01': 'ABCDEF0123456789' } });
  });

  it.each([['bad token<'], ['short'], ['"onload="x"'], ['a'.repeat(101)]])('throws on a malformed Google token %j', (token) => {
    stub(token, undefined);
    expect(() => siteVerification()).toThrow(GOOGLE);
  });

  it('throws on a malformed Bing token', () => {
    stub(undefined, 'bad token<');
    expect(() => siteVerification()).toThrow(BING);
  });
});
