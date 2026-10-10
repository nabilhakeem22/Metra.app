import { describe, expect, it } from 'vitest';
import { documentUrl } from './document-url';

describe('documentUrl', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('is the download route with no variant, and the inline view with `view`', () => {
    expect(documentUrl('en', 'tok', id)).toBe(`/en/d/tok/documents/${id}`);
    expect(documentUrl('ar-EG', 'tok', id, 'view')).toBe(`/ar-EG/d/tok/documents/${id}?variant=view`);
    expect(documentUrl('en', 'tok', id, 'thumb')).toBe(`/en/d/tok/documents/${id}?variant=thumb`);
  });

  it('encodes the token and the id, so neither can add a path or a query', () => {
    expect(documentUrl('en', 'a/b?c', 'x#y', 'view')).toBe('/en/d/a%2Fb%3Fc/documents/x%23y?variant=view');
  });

  it('F13: a token Next handed over still encoded is encoded once, not twice', () => {
    expect(documentUrl('en', 'dead%20beef', id)).toBe(`/en/d/dead%20beef/documents/${id}`);
  });
});
