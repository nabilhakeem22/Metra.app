import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleCookieSync } from './locale-cookie-sync';

// The static landing and login pages never run the middleware, so the browser
// keeps NEXT_LOCALE in step, with next-intl's attributes, and only on a change.

const writes: string[] = [];
let jar = '';

function stubCookie(initial: string) {
  jar = initial;
  writes.length = 0;
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => jar);
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
    writes.push(value);
  });
}

afterEach(() => vi.restoreAllMocks());

describe('LocaleCookieSync', () => {
  it('writes the page locale when there is no cookie', () => {
    stubCookie('');
    render(<LocaleCookieSync locale="en" />);
    expect(writes).toEqual(['NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax']);
  });

  it('replaces another locale', () => {
    stubCookie('theme=dark; NEXT_LOCALE=en');
    render(<LocaleCookieSync locale="ar-EG" />);
    expect(writes).toEqual(['NEXT_LOCALE=ar-EG; path=/; max-age=31536000; samesite=lax']);
  });

  it('writes nothing when the cookie already names the locale', () => {
    stubCookie('a=1; NEXT_LOCALE=ar-EG; b=2');
    render(<LocaleCookieSync locale="ar-EG" />);
    expect(writes).toEqual([]);
  });

  it('is not fooled by a look-alike cookie name', () => {
    stubCookie('XNEXT_LOCALE=en');
    render(<LocaleCookieSync locale="en" />);
    expect(writes).toEqual(['NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax']);
  });
});
