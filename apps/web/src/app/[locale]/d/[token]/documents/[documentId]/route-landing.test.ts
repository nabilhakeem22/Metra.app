import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Round D (R2, second fix round F2): the page a failed document lands on. A
// PICTURE (fetched under the one fixed picture locale) lands on the visitor's
// own locale, so the `<img>` following the 303 never resets their locale
// cookie. A LINK the client followed (Download, View) lands on its own page's
// locale, whatever a stale cookie says.

vi.mock('server-only', () => ({}));
const documents = vi.hoisted(() => ({ getDeliveryDocumentByToken: vi.fn() }));
vi.mock('@/lib/engagements/public-documents', () => documents);
vi.mock('@/lib/storage/signed-urls', () => ({ createSignedObjectUrl: vi.fn() }));
vi.mock('@/lib/storage/object-info', () => ({ storedObjectInfo: vi.fn() }));

const { GET } = await import('./route');

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const WITHHELD = { bucket: 'metra-files', objectKey: 'k', downloadName: 'render.png', access: 'withheld', media: 'image' };

async function landing(path: string, headers: Record<string, string>): Promise<string | null> {
  const [locale] = path.split('/').filter(Boolean);
  const request = new NextRequest(`https://app.test${path}`, { headers });
  const response = await GET(request, {
    params: Promise.resolve({ locale: locale!, token: 'tok', documentId: DOCUMENT_ID }),
  });
  expect(response.status).toBe(303);
  return response.headers.get('location');
}

const landed = (locale: string) => `https://app.test/${locale}/d/tok?document=unavailable`;

beforeEach(() => {
  documents.getDeliveryDocumentByToken.mockReset().mockResolvedValue(WITHHELD);
});

describe('a failed PICTURE lands on the visitor locale', () => {
  it.each([
    ['NEXT_LOCALE=en', {}, 'en'],
    ['', {}, 'ar-EG'],
    ['NEXT_LOCALE=fr', {}, 'ar-EG'],
    ['NEXT_LOCALE=en', { 'sec-fetch-dest': 'image' }, 'en'],
  ])('a thumb with cookie %j and %j lands on /%s', async (cookie, extra, locale) => {
    const headers = { ...(cookie ? { cookie } : {}), ...extra };
    expect(await landing(`/ar-EG/d/tok/documents/${DOCUMENT_ID}?variant=thumb`, headers)).toBe(landed(locale));
  });

  it('a lightbox view the browser fetched as an image lands on the visitor locale', async () => {
    const headers = { cookie: 'NEXT_LOCALE=en', 'sec-fetch-dest': 'image' };
    expect(await landing(`/ar-EG/d/tok/documents/${DOCUMENT_ID}?variant=view`, headers)).toBe(landed('en'));
  });
});

describe('a failed LINK lands on its own page locale, whatever the cookie says', () => {
  it.each([
    ['download from the English page, stale Arabic cookie', `/en/d/tok/documents/${DOCUMENT_ID}`, 'NEXT_LOCALE=ar-EG', 'en'],
    ['view from the English page, stale Arabic cookie', `/en/d/tok/documents/${DOCUMENT_ID}?variant=view`, 'NEXT_LOCALE=ar-EG', 'en'],
    ['download from the Arabic page, English cookie', `/ar-EG/d/tok/documents/${DOCUMENT_ID}`, 'NEXT_LOCALE=en', 'ar-EG'],
  ])('%s', async (_label, path, cookie, locale) => {
    expect(await landing(path, { cookie, 'sec-fetch-dest': 'document' })).toBe(landed(locale));
    expect(await landing(path, { cookie })).toBe(landed(locale));
  });
});
