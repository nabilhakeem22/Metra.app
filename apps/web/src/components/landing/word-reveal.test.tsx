import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { messageAt } from '@/test/render-with-intl';
import { WordReveal } from './word-reveal';

type ObserverCallback = (entries: Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void;

/** The observers the component created, with the callback each was handed. */
const observers: { callback: ObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];

class RecordingObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  constructor(callback: ObserverCallback) {
    observers.push({ callback, disconnect: this.disconnect });
  }
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce, media: query }));
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal('IntersectionObserver', RecordingObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const arabicLine = messageAt('ar-EG', 'landing.trust.line');
const englishLine = messageAt('en', 'landing.trust.line');

describe('WordReveal', () => {
  test.each([
    ['ar-EG', arabicLine],
    ['en', englishLine],
  ])('renders the whole %s sentence, sharp, before any reveal', (_locale, line) => {
    stubReducedMotion(false);
    const { container } = render(<WordReveal text={line} />);
    const paragraph = container.querySelector('p')!;
    expect(paragraph.textContent).toBe(line);
    expect(paragraph.className).toBe('landing-reveal');
  });

  test('splits by word, never by letter, so Arabic words stay whole', () => {
    stubReducedMotion(false);
    const { container } = render(<WordReveal text={arabicLine} />);
    const words = [...container.querySelectorAll('.landing-word')].map((word) => word.textContent);
    expect(words).toEqual(arabicLine.split(' '));
    expect(words.every((word) => word!.length > 0 && !/\s/.test(word!))).toBe(true);
  });

  test('blurs only once the line enters view, and observes it once', () => {
    stubReducedMotion(false);
    const { container } = render(<WordReveal text={englishLine} />);
    const paragraph = container.querySelector('p')!;
    expect(observers).toHaveLength(1);

    act(() => observers[0].callback([{ isIntersecting: false }]));
    expect(paragraph.className).toBe('landing-reveal');

    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(paragraph.className).toBe('landing-reveal is-revealing');
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  test('does nothing under reduced motion: no observer, the text simply shown', () => {
    stubReducedMotion(true);
    const { container } = render(<WordReveal text={englishLine} />);
    const paragraph = container.querySelector('p')!;
    expect(observers).toHaveLength(0);
    expect(paragraph.className).toBe('landing-reveal');
    expect(paragraph.textContent).toBe(englishLine);
  });
});
