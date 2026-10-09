import { describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES, logoRefusal } from './logo-rules';

describe('logoRefusal (S3)', () => {
  it.each([
    ['logo.png', 'image/png'],
    ['logo.JPG', 'image/jpeg'],
    ['logo.jpeg', 'image/jpeg'],
    ['logo.webp', 'image/webp'],
  ])('%s as %s is accepted', (originalName, contentType) => {
    expect(logoRefusal({ originalName, contentType })).toBeNull();
    expect(logoRefusal({ originalName, contentType, size: LOGO_MAX_BYTES })).toBeNull();
  });

  it.each([
    ['an SVG', 'logo.svg', 'image/svg+xml'],
    ['a PNG name stored as SVG', 'logo.png', 'image/svg+xml'],
    ['a PNG name stored as HTML', 'logo.png', 'text/html'],
    ['a GIF', 'logo.gif', 'image/gif'],
    ['no name', undefined, 'image/png'],
    ['no type', 'logo.png', undefined],
  ])('%s is refused as invalid', (_label, originalName, contentType) => {
    expect(logoRefusal({ originalName, contentType })).toBe('invalid');
  });

  it('a logo over 2 MB is too large; an empty one is invalid', () => {
    expect(logoRefusal({ originalName: 'logo.png', contentType: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe('file_too_large');
    expect(logoRefusal({ originalName: 'logo.png', contentType: 'image/png', size: 0 })).toBe('invalid');
  });
});
