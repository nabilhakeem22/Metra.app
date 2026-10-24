// PURE placement of a layer anchored to a control (a combobox's list, a
// picker's panel): which side of the control it opens on, where its inline
// start sits, how wide and how tall it may be. No DOM, so flip, shift and RTL
// are unit-testable; components/ui/anchored-layer.tsx feeds it measurements.
import { clampInset, inlineStartOffset, type AnchorBox } from './viewport-inset';

/** Space kept between the layer and the viewport edge, in px. */
export const LAYER_VIEWPORT_MARGIN = 8;
/** Space between the control and the layer, in px. */
export const LAYER_GAP = 4;

export interface AnchoredPlacementInput {
  /** The control's viewport box (its getBoundingClientRect, in logical terms). */
  anchor: AnchorBox;
  viewport: { width: number; height: number };
  /** The layer's full content height, unclipped by any max-height. */
  contentHeight: number;
  /** The tallest the layer may ever be, in px. */
  maxHeight: number;
  /** 'anchor' = exactly the control's width; a number = that width in px, capped by the viewport. */
  width: 'anchor' | number;
  rtl: boolean;
}

export interface AnchoredPlacement {
  side: 'below' | 'above';
  /** Viewport offset of the layer's top edge (side 'below') or bottom edge (side 'above'). */
  blockOffset: number;
  /** Logical inset-inline-start, measured from the inline-start viewport edge. */
  insetInlineStart: number;
  width: number;
  maxHeight: number;
}

/**
 * Below the control while the content fits there; above it when it does not
 * and there is more room above (it then grows upward from the control's top).
 * Starts on the control's inline-start edge (the right edge in RTL) and is
 * shifted back inside the viewport when it would spill over either edge.
 */
export function anchoredPlacement(input: AnchoredPlacementInput): AnchoredPlacement {
  const { anchor, viewport, contentHeight, rtl } = input;
  const roomBelow = Math.max(0, viewport.height - anchor.bottom - LAYER_GAP - LAYER_VIEWPORT_MARGIN);
  const roomAbove = Math.max(0, anchor.top - LAYER_GAP - LAYER_VIEWPORT_MARGIN);
  const wanted = Math.min(contentHeight, input.maxHeight);
  const side = wanted <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';
  const room = side === 'below' ? roomBelow : roomAbove;

  const widest = Math.max(0, viewport.width - LAYER_VIEWPORT_MARGIN * 2);
  const width = Math.min(input.width === 'anchor' ? anchor.width : input.width, widest);
  const start = inlineStartOffset(anchor.nearEdge, anchor.farEdge, rtl, viewport.width);

  return {
    side,
    blockOffset: side === 'below' ? anchor.bottom + LAYER_GAP : viewport.height - anchor.top + LAYER_GAP,
    insetInlineStart: clampInset(start, width, viewport.width, LAYER_VIEWPORT_MARGIN),
    width,
    maxHeight: Math.min(input.maxHeight, room),
  };
}
