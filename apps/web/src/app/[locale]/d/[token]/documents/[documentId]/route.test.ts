import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MAX_EDGE, PREVIEW_QUALITY } from '@/lib/engagements/document-access';

// AC 31: `?variant=view` signs WITHOUT a download name (a preview keeps its
// 1400 px rendition), no variant signs WITH it, any other variant is the same
// indistinguishable "unavailable" redirect, and every signed link lives 300 s.

const documents = vi.hoisted(() => ({ getDeliveryDocumentByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-documents', () => documents);
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);

const { GET } = await import('./route');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const SIGNED = 'https://storage.test/signed';
const DOWNLOAD = { bucket: 'metra-files', objectKey: 'org/file.pdf', downloadName: 'drawing.pdf', access: 'download' };
const PREVIEW_TRANSFORM = {
  transform: { width: PREVIEW_MAX_EDGE, height: PREVIEW_MAX_EDGE, resize: 'contain', quality: PREVIEW_QUALITY },
};

function get(query = '', documentId = DOCUMENT_ID) {
  const request = new NextRequest(`https://app.test/en/d/tok/documents/${documentId}${query}`);
  return GET(request, { params: Promise.resolve({ locale: 'en', token: 'tok', documentId }) });
}

function expectUnavailable(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('https://app.test/en/d/tok?document=unavailable');
  expect(response.headers.get('cache-control')).toBe('no-store');
}

beforeEach(() => {
  documents.getDeliveryDocumentByToken.mockReset().mockResolvedValue(DOWNLOAD);
  storage.createSignedObjectUrl.mockReset().mockResolvedValue(SIGNED);
});

describe('the client document route', () => {
  it('no variant: the download, signed with the client-facing name for 300 s', async () => {
    const response = await get();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(SIGNED);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', 'org/file.pdf', 300, {
      download: 'drawing.pdf',
    });
  });

  it('?variant=view: signed WITHOUT a download name, so the browser opens it', async () => {
    const response = await get('?variant=view');
    expect(response.status).toBe(302);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', 'org/file.pdf', 300, undefined);
  });

  it.each(['', '?variant=view'])('a preview keeps its 1400 px rendition and no name (%s)', async (query) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue({ ...DOWNLOAD, access: 'preview' });
    expect((await get(query)).status).toBe(302);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', 'org/file.pdf', 300, PREVIEW_TRANSFORM);
  });

  it.each(['?variant=other', '?variant=thumb', '?variant=', '?variant=VIEW'])(
    '%s: the indistinguishable unavailable redirect, before any read',
    async (query) => {
      expectUnavailable(await get(query));
      expect(documents.getDeliveryDocumentByToken).not.toHaveBeenCalled();
      expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
    },
  );

  it('a withheld document is refused the same way, whichever variant', async () => {
    documents.getDeliveryDocumentByToken.mockResolvedValue({ ...DOWNLOAD, access: 'withheld' });
    expectUnavailable(await get('?variant=view'));
    expectUnavailable(await get());
    expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
  });

  it('a malformed id, an unknown document or a storage failure: the same redirect', async () => {
    expectUnavailable(await get('?variant=view', 'not-a-uuid'));
    documents.getDeliveryDocumentByToken.mockResolvedValue(null);
    expectUnavailable(await get('?variant=view'));
    documents.getDeliveryDocumentByToken.mockResolvedValue(DOWNLOAD);
    storage.createSignedObjectUrl.mockRejectedValue(new Error('storage down'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    expectUnavailable(await get('?variant=view'));
    expect(logged).toHaveBeenCalledWith('delivery document download failed');
    logged.mockRestore();
  });
});
