'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { CoachmarkCard } from './coachmark-card';
import { ANCHOR_PADDING, type CoachmarkPlacement } from './coachmark-logic';
import { useAnchorRect } from './use-anchor-rect';
import { useCoachmarkPlacement } from './use-coachmark-placement';
import { useTour } from './use-tour';

/** The dimmer plus the ring around the anchor. Both are decoration: aria-hidden,
 *  pointer-events none, so the page underneath stays reachable to a screen reader
 *  and the card above is the only interactive thing. */
function CoachmarkHighlight({
  rect,
  placement,
  animated,
}: {
  rect: DOMRect;
  placement: CoachmarkPlacement;
  animated: boolean;
}) {
  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 z-[60] bg-foreground/30"
        style={{ pointerEvents: 'none' }}
      />
      <div
        aria-hidden
        className={cn(
          'fixed z-[61] rounded-lg border-2 border-primary',
          animated && 'transition-all',
        )}
        style={{
          top: rect.top - ANCHOR_PADDING,
          insetInlineStart: placement.highlightInset - ANCHOR_PADDING,
          width: rect.width + ANCHOR_PADDING * 2,
          height: rect.height + ANCHOR_PADDING * 2,
          pointerEvents: 'none',
        }}
      />
    </>
  );
}

/**
 * The onboarding coachmark — COMPOSITION.
 *
 * Each of the four things this used to do is now the file named after it: finding
 * and measuring the anchor (use-anchor-rect), turning two measurements into a
 * position (use-coachmark-placement, over the pure resolveCoachmarkPlacement),
 * the dialog and its focus trap (coachmark-card), and the dimmer and ring here.
 */
export function Coachmark({ paused = false }: { paused?: boolean }) {
  const { current, next, prev, stop, index, total } = useTour();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const onPage = !!current && current.page === pathname;
  const active = onPage && !paused;
  // `next` is the self-skip: an anchor that never appears is a step we move past.
  const onMissing = useCallback(() => next(), [next]);
  const rect = useAnchorRect({
    anchor: active && current ? current.anchor : null,
    onMissing,
  });
  const placement = useCoachmarkPlacement({
    cardRef,
    rect,
    stepId: current?.id ?? null,
  });

  if (!mounted || !current || !active || !rect || !placement) return null;

  const animated = !(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  return createPortal(
    <>
      <CoachmarkHighlight rect={rect} placement={placement} animated={animated} />
      <CoachmarkCard
        cardRef={cardRef}
        step={current}
        position={{ top: placement.cardTop, insetInlineStart: placement.cardInset }}
        index={index}
        total={total}
        controls={{ next, prev, stop }}
      />
    </>,
    document.body,
  );
}
