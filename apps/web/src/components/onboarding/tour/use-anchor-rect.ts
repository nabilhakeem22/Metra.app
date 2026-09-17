'use client';

import { useEffect, useState } from 'react';

/**
 * Locate the tour anchor, measure it, and KEEP it measured.
 *
 * ONE concern: where the highlighted element is on screen right now. Three
 * observers feed it — a ResizeObserver on the anchor, a capturing scroll listener
 * (capturing, because the page that scrolls may be an inner container) and a
 * window resize — and all three answer the same question.
 *
 * A MISSING ANCHOR SELF-SKIPS rather than throwing. The element may not be
 * mounted on the frame the step becomes current, so it retries for ~30 frames and
 * then calls `onMissing`: a tour that dies on a slow render is worse than a tour
 * that quietly moves on.
 */
export function useAnchorRect(options: {
  /** The `data-tour` value to find, or null to measure nothing. */
  anchor: string | null;
  onMissing: () => void;
}): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const { anchor, onMissing } = options;

  useEffect(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    let observer: ResizeObserver | null = null;
    let element: HTMLElement | null = null;

    const measure = () => {
      if (element) setRect(element.getBoundingClientRect());
    };
    const find = () => {
      element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
      if (element) {
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(element);
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(find);
      } else {
        onMissing();
      }
    };
    find();

    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [anchor, onMissing]);

  return rect;
}
