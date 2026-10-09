import { describe, expect, it } from 'vitest';
import { documentUrl } from './document-url';

describe('documentUrl', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('is the download route with no variant, and the inline view with `view`', () => {
    expect(documentUrl('en', 'tok', id)).toBe(`/en/d/tok/documents/${id}`);
    expect(documentUrl('ar-EG', 'tok', id, 'view')).toBe(`/ar-EG/d/tok/documents/${id}?variant=view`);
  });

  it('encodes the token and the id, so neither can add a path or a query', () => {
    expect(documentUrl('en', 'a/b?c', 'x#y', 'view')).toBe('/en/d/a%2Fb%3Fc/documents/x%23y?variant=view');
  });
});
