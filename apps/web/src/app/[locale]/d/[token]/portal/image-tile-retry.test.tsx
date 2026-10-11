import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { picturesStillLoading } from '@/test/picture-loading';
import { renderWithIntl } from '@/test/render-with-intl';
import { ImageTile } from './image-tile';
import { PICTURE_RETRY_DELAY_MS } from './use-picture-retry';

// Round D (R2): a gallery tile that fails (a 429 from the link's read budget,
// say) retries ONCE after the routes' Retry-After, only while mounted, before
// the placeholder stays; and its URL is the same in both page locales, so a
// language switch reuses the cached tile.

const IMAGE = {
  id: '11111111-1111-4111-8111-111111111111',
  category: 'render',
  sharedAt: '2026-10-10T10:00:00Z',
} as unknown as PortalDocument;

const picture = () => document.querySelector('img');

function renderTile(locale: 'en' | 'ar-EG' = 'en') {
  return renderWithIntl(<ImageTile token="tok" image={IMAGE} onOpen={() => {}} />, { locale });
}

beforeEach(() => {
  vi.useFakeTimers();
  picturesStillLoading();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ImageTile retry', () => {
  it('waits at most 60 s', () => {
    expect(PICTURE_RETRY_DELAY_MS).toBeGreaterThan(0);
    expect(PICTURE_RETRY_DELAY_MS).toBeLessThanOrEqual(60_000);
  });

  it('a failed tile shows the placeholder, retries once after the delay, and loads', () => {
    renderTile();
    const first = picture()!;
    fireEvent.error(first);
    expect(picture()).toBeNull();
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS - 1));
    expect(picture()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const retried = picture()!;
    expect(retried).not.toBe(first);
    expect(retried.getAttribute('src')).toBe(first.getAttribute('src'));
    fireEvent.load(retried);
    expect(picture()).toBe(retried);
  });

  it('a second failure keeps the placeholder for good: one retry, no more', () => {
    renderTile();
    fireEvent.error(picture()!);
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS));
    fireEvent.error(picture()!);
    expect(picture()).toBeNull();
    act(() => vi.advanceTimersByTime(PICTURE_RETRY_DELAY_MS * 3));
    expect(picture()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an unmounted tile leaves no retry timer behind', () => {
    renderTile();
    fireEvent.error(picture()!);
    expect(vi.getTimerCount()).toBe(1);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the tile URL is the same in both page locales', () => {
    renderTile('en');
    const english = picture()!.getAttribute('src');
    cleanup();
    renderTile('ar-EG');
    expect(picture()!.getAttribute('src')).toBe(english);
    expect(english).toBe(`/ar-EG/d/tok/documents/${IMAGE.id}?variant=thumb`);
  });
});
