import { act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { messagesFor } from '@/test/render-with-intl';
import { ImageTile } from './image-tile';
import { PICTURE_RETRY_DELAY_MS } from './use-picture-retry';

// Round D second fix round (F1): a tile whose picture failed BEFORE hydration
// (a refused read answers in milliseconds, hydration takes hundreds) fired its
// error with no listener, and React does not replay it. The tile must still
// notice on mount, show the placeholder, and retry once.

const IMAGE = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'render',
  sharedAt: '2026-10-10T10:00:00Z',
} as unknown as PortalDocument;

const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get');
const naturalWidth = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get');

function tile() {
  return (
    <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
      <ImageTile token="tok" image={IMAGE} onOpen={() => {}} />
    </NextIntlClientProvider>
  );
}

let container: HTMLElement;
let root: Root | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  container.innerHTML = renderToString(tile());
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

const picture = () => container.querySelector('img');

describe('ImageTile hydrating over a picture that already failed', () => {
  it('shows the placeholder, retries once after the delay, then keeps the placeholder', () => {
    const serverSrc = picture()!.getAttribute('src');
    // The browser already answered the server-rendered <img> with an error.
    complete.mockReturnValue(true);
    naturalWidth.mockReturnValue(0);
    act(() => {
      root = hydrateRoot(container, tile());
    });
    expect(picture()).toBeNull();
    // The retried picture is still loading when it mounts.
    complete.mockReturnValue(false);
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS));
    const retried = picture()!;
    expect(retried.getAttribute('src')).toBe(serverSrc);
    act(() => {
      retried.dispatchEvent(new Event('error'));
    });
    expect(picture()).toBeNull();
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS * 3));
    expect(picture()).toBeNull();
  });

  it('a picture that loaded before hydration is left alone', () => {
    complete.mockReturnValue(true);
    naturalWidth.mockReturnValue(480);
    act(() => {
      root = hydrateRoot(container, tile());
    });
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS * 2));
    expect(picture()).not.toBeNull();
  });
});
