import { describe, expect, it } from 'vitest';
import { isIndexablePath, landingLanguageAlternates, landingPath, X_DEFAULT_LOCALE } from './indexable-pages';

describe('isIndexablePath', () => {
  it.each<[string, boolean]>([
    ['/ar-EG', true],
    ['/en', true],
    ['/ar-EG/', false],
    ['/en/', false],
    ['/', false],
    ['/ar-EG/login', false],
    ['/en/dashboard', false],
    ['/en/d/abc', false],
    ['/EN', false],
    ['/ar-eg', false],
    ['/fr', false],
    ['/ar-EG?x=1', false],
    ['', false],
  ])('%j is indexable: %s', (pathname, expected) => {
    expect(isIndexablePath(pathname)).toBe(expected);
  });
});

describe('landing alternates', () => {
  it('maps each locale to its landing and x-default to the default locale', () => {
    expect(landingLanguageAlternates()).toEqual({ 'ar-EG': '/ar-EG', en: '/en', 'x-default': '/ar-EG' });
  });

  it('x-default is the default locale', () => {
    expect(X_DEFAULT_LOCALE).toBe('ar-EG');
    expect(landingPath(X_DEFAULT_LOCALE)).toBe('/ar-EG');
  });
});
