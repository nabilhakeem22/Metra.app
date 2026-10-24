'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onOutside` when a pointer goes down outside EVERY one of `insideRefs`.
 * A control whose popup is portaled (components/ui/anchored-layer.tsx) is two
 * DOM trees, the control and its layer, so both count as inside. Bound only
 * while `open`; the latest refs and callback are read at the event, so an
 * inline callback does not re-bind the listener on every render.
 */
export function useOutsidePointerDown(
  open: boolean,
  insideRefs: ReadonlyArray<RefObject<HTMLElement | null>>,
  onOutside: () => void,
): void {
  const latest = useRef({ insideRefs, onOutside });
  useEffect(() => {
    latest.current = { insideRefs, onOutside };
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (latest.current.insideRefs.some((ref) => ref.current?.contains(target))) return;
      latest.current.onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);
}
