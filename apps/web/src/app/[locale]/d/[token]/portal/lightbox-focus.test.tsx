import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { Gallery } from './gallery';
import { ConfirmActDialog } from './confirm-act-dialog';

// Fix round F4 (focus returns to the opener), F5 (the lightbox keeps its
// picture by id across a refresh that adds one), F13 (the thread's hint fits
// the lightbox).

vi.mock('../actions', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const en = (path: string) => messageAt('en', path);
const pic = (n: number): PortalDocument => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`,
  category: 'render',
  sharedAt: `2026-10-0${n}T09:00:00.000Z`,
  commentCount: 0,
  access: 'download',
  media: 'image',
});

/** The gallery with a hidden button that lands "the refresh": a new newest picture. */
function GalleryWithRefresh() {
  const [images, setImages] = useState([pic(2), pic(1)]);
  return (
    <>
      <button type="button" onClick={() => setImages([pic(3), pic(2), pic(1)])}>
        land refresh
      </button>
      <Gallery token="tok" images={images} />
    </>
  );
}

/** Radix moves focus back on a zero-delay timer after the dialog unmounts. */
const afterClose = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)));

const shownSrc = () => within(screen.getByRole('dialog')).getAllByRole('img')[0]!.getAttribute('src');

describe('the lightbox', () => {
  it('F4: closing returns focus to the tile that opened it', async () => {
    renderWithIntl(<Gallery token="tok" images={[pic(2), pic(1)]} />, { locale: 'en' });
    const tile = document.querySelectorAll<HTMLButtonElement>('li button')[1]!;
    tile.focus();
    fireEvent.click(tile);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en('delivery.lightbox.close') }));
    await afterClose();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(tile);
  });

  it('F5: a picture released while it is open does not swap the picture or its thread', () => {
    renderWithIntl(<GalleryWithRefresh />, { locale: 'en' });
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('li button')[1]!);
    expect(shownSrc()).toContain(pic(1).id);
    fireEvent.click(screen.getByText('land refresh'));
    expect(shownSrc()).toContain(pic(1).id);
    expect(within(screen.getByRole('dialog')).getByText('3 of 3')).toBeTruthy();
  });

  it('F13: the thread hint says the page buttons are behind this view', () => {
    renderWithIntl(<Gallery token="tok" images={[pic(1)]} />, { locale: 'en' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('li button')!);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en('delivery.comments.toggleEmpty') }));
    expect(within(screen.getByRole('dialog')).getByText(en('delivery.comments.advisoryLightbox'))).toBeTruthy();
    expect(screen.queryByText(en('delivery.comments.advisory'))).toBeNull();
  });
});

describe('the confirm dialog', () => {
  it('F4: Cancel returns focus to the button that opened it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Approve
          </button>
          <ConfirmActDialog open={open} title="Sure?" body="Body" confirmLabel="Yes" cancelLabel="No" pending={false} onConfirm={() => {}} onOpenChange={setOpen} />
        </>
      );
    }
    renderWithIntl(<Harness />, { locale: 'en' });
    const opener = screen.getByRole('button', { name: 'Approve' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'No' }));
    await afterClose();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
