'use client';

import type { HTMLAttributes, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPlacement, type AnchoredSizing } from '@/hooks/use-anchored-placement';
import { cn } from '@/lib/utils';

/**
 * The floating layer of a custom combobox or picker (a suggestion list, a
 * search panel): rendered into document.body and fixed to its control, so no
 * card around the control can clip it or paint over it. A glass card's
 * backdrop-filter (like a transform or an overflow) makes a stacking context,
 * and nothing inside one can rise above a LATER sibling card, whatever its
 * z-index; out here the layer only competes with other body-level layers.
 *
 * z-[70] puts it above the sheets and dialogs (z-50) and the tour (z-60..62),
 * so a picker opened inside a sheet shows over the sheet, and below the toasts
 * (z-[100]). pointer-events is set back to auto because an open modal dialog
 * turns them off on <body>; React still treats the layer as inside the
 * dialog's tree, so a press on it does not dismiss the dialog.
 *
 * Flips above the control when it does not fit below, shifts to stay on screen,
 * starts on the control's inline-start edge in both directions and scrolls past
 * `maxHeight` (hooks/use-anchored-placement.ts). Mount it only while open.
 */
export function AnchoredLayer({
  anchorRef,
  layerRef,
  width,
  maxHeight,
  className,
  children,
  ...attributes
}: AnchoredSizing &
  Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'dir'> & {
    /** The control the layer opens from (the input, or the button). */
    anchorRef: RefObject<HTMLElement | null>;
    /** The layer element, for the caller's outside-press test. */
    layerRef: RefObject<HTMLDivElement | null>;
    children: ReactNode;
  }) {
  useAnchoredPlacement(anchorRef, layerRef, { width, maxHeight });
  return createPortal(
    <div
      ref={layerRef}
      data-anchored-layer=""
      className={cn('fixed z-[70] overflow-auto', className)}
      style={{ pointerEvents: 'auto' }}
      {...attributes}
    >
      {children}
    </div>,
    document.body,
  );
}
