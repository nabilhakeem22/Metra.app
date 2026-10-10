import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { DocumentsCard } from './documents-card';

// AC 51: pictures load through ?variant=thumb, a withheld file never shows as
// one, PDFs stay rows; the lightbox steps with buttons and with the arrow keys
// in the READING direction; Download only when the client may have the file.

vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const id = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
function doc(n: number, overrides: Partial<PortalDocument>): PortalDocument {
  return { id: id(n), category: 'render', sharedAt: '2026-10-01T09:00:00.000Z', commentCount: 0, access: 'download', media: 'image', ...overrides };
}
const DOCUMENTS = [
  doc(1, {}),
  doc(2, { access: 'preview' }),
  doc(3, { access: 'withheld' }),
  doc(4, { category: 'drawing', media: 'pdf' }),
];

function renderCard(locale: TestLocale = 'en') {
  return renderWithIntl(<DocumentsCard token="tok" documents={DOCUMENTS} documentUnavailable={false} />, { locale });
}

const thumbs = () => [...document.querySelectorAll('img')].map((image) => image.getAttribute('src'));

describe('the gallery', () => {
  it('tiles only previewable images, through the thumb variant; the withheld one and the PDF stay rows', () => {
    renderCard();
    expect(thumbs()).toEqual([`/en/d/tok/documents/${id(1)}?variant=thumb`, `/en/d/tok/documents/${id(2)}?variant=thumb`]);
    const rows = document.querySelectorAll('#documents ul.space-y-2 > li');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(messageAt('en', 'delivery.documents.afterPayment'));
    const tile = screen.getAllByRole('button', { name: messageAt('en', 'delivery.gallery.imageAlt').replace('{category}', '3D visual').replace('{date}', '⁨01/10/2026⁩') })[0]!;
    expect(tile.className).toMatch(/(^|\s)min-h-11(\s|$)/);
  });

  it.each([
    ['en', 'ArrowRight', 'ArrowLeft'],
    ['ar-EG', 'ArrowLeft', 'ArrowRight'],
  ] as const)('the lightbox steps forward with %s %s, back with %s; Download only when paid', (locale, forward, back) => {
    renderCard(locale);
    fireEvent.click(document.querySelectorAll('#documents li button')[0]!);
    const dialog = screen.getByRole('dialog');
    const view = () => within(dialog).getAllByRole('img')[0]!.getAttribute('src');
    expect(view()).toBe(`/${locale}/d/tok/documents/${id(1)}?variant=view`);
    expect(within(dialog).getByRole('link', { name: messageAt(locale, 'delivery.documents.download') })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: forward });
    expect(view()).toBe(`/${locale}/d/tok/documents/${id(2)}?variant=view`);
    // Paid only in preview: no Download.
    expect(within(dialog).queryByRole('link', { name: messageAt(locale, 'delivery.documents.download') })).toBeNull();
    fireEvent.keyDown(dialog, { key: back });
    expect(view()).toBe(`/${locale}/d/tok/documents/${id(1)}?variant=view`);
    fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.lightbox.next') }));
    expect(view()).toBe(`/${locale}/d/tok/documents/${id(2)}?variant=view`);
    expect(within(dialog).getByRole('button', { name: messageAt(locale, 'delivery.lightbox.next') }).hasAttribute('disabled')).toBe(true);
  });

  it('a thumbnail Storage could not make shows a plain mark and keeps its name', () => {
    renderCard();
    fireEvent.error(document.querySelector('img')!);
    expect(thumbs()).toHaveLength(1);
  });
});
