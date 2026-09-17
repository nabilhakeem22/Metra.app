'use client';

import { useEffect, useState, type RefObject } from 'react';
import {
  resolveCoachmarkPlacement,
  type CoachmarkPlacement,
} from './coachmark-logic';

/** The card's own measured size. The step's content decides its height. */
interface CardSize {
  width: number;
  height: number;
}

const DEFAULT_CARD: CardSize = { width: 288, height: 168 };

/**
 * Where the coachmark goes.
 *
 * ONE concern: turning the measured anchor and the measured card into a position.
 * The arithmetic itself is pure (`resolveCoachmarkPlacement`); this hook only owns
 * measuring the card, which cannot be pure because its height varies by step
 * content and only the browser knows it.
 *
 * The card measurement is GUARDED so it never loops on identical measurements:
 * setting state from a layout read that the state change itself re-triggers is
 * the classic infinite render.
 */
export function useCoachmarkPlacement(options: {
  cardRef: RefObject<HTMLDivElement | null>;
  rect: DOMRect | null;
  /** Re-measure when the step changes: different copy, different height. */
  stepId: string | null;
}): CoachmarkPlacement | null {
  const [cardSize, setCardSize] = useState<CardSize>(DEFAULT_CARD);
  const { cardRef, rect, stepId } = options;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measured = card.getBoundingClientRect();
    setCardSize((current) =>
      Math.abs(current.width - measured.width) < 1 &&
      Math.abs(current.height - measured.height) < 1
        ? current
        : { width: measured.width, height: measured.height },
    );
  }, [cardRef, rect, stepId]);

  if (!rect) return null;
  return resolveCoachmarkPlacement({
    // The DOMRect's physical edges become LOGICAL ones here, at the single point
    // where the browser's coordinate system meets ours.
    anchor: {
      top: rect.top,
      bottom: rect.bottom,
      nearEdge: rect.left,
      farEdge: rect.right,
      width: rect.width,
      height: rect.height,
    },
    card: cardSize,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    rtl: document.documentElement.dir === 'rtl',
  });
}
