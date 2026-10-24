'use client';

import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';
import { anchoredPlacement } from '@/lib/ui/anchored-placement';

export interface AnchoredSizing {
  /** 'anchor' = exactly the control's width; a number = that width in px. */
  width: 'anchor' | number;
  /** The tallest the layer may be, in px; less when the viewport has less room. */
  maxHeight: number;
}

const px = (value: number) => `${Math.round(value)}px`;

/**
 * Keeps a `position: fixed` layer on its control: placed before the first paint
 * and after every render (its content may have grown), and again on any scroll
 * (captured, so an inner scroll box counts too), on a window resize and when the
 * control itself resizes. Writes the layer's style directly, so following a
 * scroll costs no React render. The layer takes the control's direction, so its
 * logical inset means the same edge the control's start does.
 */
export function useAnchoredPlacement(
  anchorRef: RefObject<HTMLElement | null>,
  layerRef: RefObject<HTMLElement | null>,
  { width, maxHeight }: AnchoredSizing,
): void {
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const layer = layerRef.current;
    if (!anchor || !layer) return;
    // The nearest dir wins: the field's own (a combobox sets it), else the page's.
    const rtl = anchor.closest('[dir]')?.getAttribute('dir') === 'rtl';
    const rect = anchor.getBoundingClientRect();
    const placement = anchoredPlacement({
      // The DOMRect's physical edges become logical ones here.
      anchor: { top: rect.top, bottom: rect.bottom, nearEdge: rect.left, farEdge: rect.right, width: rect.width, height: rect.height },
      viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      contentHeight: layer.scrollHeight + layer.offsetHeight - layer.clientHeight,
      maxHeight,
      width,
      rtl,
    });
    layer.dir = rtl ? 'rtl' : 'ltr';
    layer.dataset.side = placement.side;
    layer.style.top = placement.side === 'below' ? px(placement.blockOffset) : 'auto';
    layer.style.bottom = placement.side === 'above' ? px(placement.blockOffset) : 'auto';
    layer.style.insetInlineStart = px(placement.insetInlineStart);
    layer.style.width = px(placement.width);
    layer.style.maxHeight = px(placement.maxHeight);
  }, [anchorRef, layerRef, width, maxHeight]);

  useLayoutEffect(place);

  useEffect(() => {
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [place, anchorRef]);
}
