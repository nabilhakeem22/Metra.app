import { describe, expect, it } from 'vitest';
import { pictureUrl } from '@/app/[locale]/d/[token]/portal/document-url';
import { isPortalPicturePath, PICTURE_LOCALE, portalLogoPath } from './portal-picture-path';

// Round D (R2): every client-page picture is addressed under ONE locale
// segment, so a language switch hits the browser cache instead of re-spending
// the link's read budget.

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

describe('client-page picture paths', () => {
  it('are built under the one picture locale, whatever the page locale', () => {
    expect(PICTURE_LOCALE).toBe('ar-EG');
    expect(pictureUrl('tok', DOCUMENT_ID, 'thumb')).toBe(`/ar-EG/d/tok/documents/${DOCUMENT_ID}?variant=thumb`);
    expect(pictureUrl('tok', DOCUMENT_ID, 'view')).toBe(`/ar-EG/d/tok/documents/${DOCUMENT_ID}?variant=view`);
    expect(portalLogoPath('tok')).toBe('/ar-EG/d/tok/logo');
  });

  it('encode the token once, like every other client-page URL', () => {
    expect(portalLogoPath('a/b?c')).toBe('/ar-EG/d/a%2Fb%3Fc/logo');
    expect(portalLogoPath('dead%20beef')).toBe('/ar-EG/d/dead%20beef/logo');
  });

  it('are recognised for the middleware, and nothing else is', () => {
    expect(isPortalPicturePath(portalLogoPath('tok'))).toBe(true);
    expect(isPortalPicturePath(`/ar-EG/d/tok/documents/${DOCUMENT_ID}`)).toBe(true);
    for (const path of [
      '/ar-EG/d/tok',
      '/en/d/tok/logo',
      `/en/d/tok/documents/${DOCUMENT_ID}`,
      '/ar-EG/d/tok/logo/extra',
      '/ar-EG/p/tok/logo',
      '/ar-EG/dashboard',
      '/ar-EG/d//logo',
    ]) {
      expect(isPortalPicturePath(path)).toBe(false);
    }
  });
});
