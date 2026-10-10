import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Round C, AC 51 and 52: a gallery tile (?variant=thumb) is the 480 px
// rendition's BYTES, streamed from the app whether the client has paid or not,
// never a storage URL; anything that is not a previewable image is the
// indistinguishable "unavailable" redirect, with nothing signed.

vi.mock('server-only', () => ({}));
const documents = vi.hoisted(() => ({ getDeliveryDocumentByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-documents', () => documents);
const storage = vi.hoisted(() => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/signed-urls', () => storage);
vi.mock('@/lib/storage/object-info', () => ({ storedObjectInfo: vi.fn() }));

const { GET } = await import('./route');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_KEY = 'org-1/engagement/file-9';
const PAID = { bucket: 'metra-files', objectKey: OBJECT_KEY, downloadName: 'drawing.pdf', access: 'download', media: 'pdf' };
const UNPAID = { ...PAID, downloadName: 'render.png', access: 'preview', media: 'image' };
const PAID_IMAGE = { ...PAID, downloadName: 'render.png', media: 'image' };
const fetchMock = vi.fn();

function get(query: string) {
  const request = new NextRequest(`https://app.test/en/d/tok/documents/${DOCUMENT_ID}${query}`);
  return GET(request, { params: Promise.resolve({ locale: 'en', token: 'tok', documentId: DOCUMENT_ID }) });
}

function expectUnavailable(response: Response) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('https://app.test/en/d/tok?document=unavailable');
}

beforeEach(() => {
  documents.getDeliveryDocumentByToken.mockReset();
  storage.createSignedObjectUrl.mockReset().mockResolvedValue('https://storage.test/render/image/sign/x?token=R');
  fetchMock.mockReset().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('gallery tiles (?variant=thumb, AC 51, 52): streamed bytes, paid or not', () => {
  it.each([
    ['unpaid', UNPAID],
    ['paid', PAID_IMAGE],
  ])('%s image: the 480 px tile itself, never a URL', async (_label, document) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(document);
    const response = await get('?variant=thumb');
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(storage.createSignedObjectUrl).toHaveBeenCalledTimes(1);
    expect(storage.createSignedObjectUrl).toHaveBeenCalledWith('metra-files', OBJECT_KEY, 30, {
      transform: { width: 480, height: 480, resize: 'cover', quality: 60 },
    });
  });

  it.each([
    ['a PDF', PAID],
    ['an other file', { ...PAID, downloadName: 'drawing.dwg', media: 'other' }],
    ['a withheld image', { ...PAID_IMAGE, access: 'withheld' }],
  ])('%s: unavailable, nothing signed', async (_label, document) => {
    documents.getDeliveryDocumentByToken.mockResolvedValue(document);
    expectUnavailable(await get('?variant=thumb'));
    expect(storage.createSignedObjectUrl).not.toHaveBeenCalled();
  });
});
