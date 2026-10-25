// PURE viewport helpers in LOGICAL space (inset-inline-start), shared by every
// layer that floats over the page: the onboarding coachmark and the anchored
// listbox layer (components/ui/anchored-layer). No DOM, so RTL is unit-testable.

/**
 * The logical inset-inline-start offset for the anchor: distance from the
 * INLINE-START viewport edge. In LTR that's the physical near edge; in RTL it
 * flips to be measured from the physical far edge, so `insetInlineStart`
 * positions correctly in both. `nearEdge`/`farEdge` = rect.left / rect.right.
 */
export function inlineStartOffset(
  nearEdge: number,
  farEdge: number,
  rtl: boolean,
  viewportWidth: number,
): number {
  return rtl ? viewportWidth - farEdge : nearEdge;
}

/**
 * Clamp a logical inset so a box of `boxSize` stays fully inside `viewportSize`
 * with `margin` on both edges. Operates in logical space (inset-inline-start),
 * so it is correct in LTR and RTL alike: the viewport width is direction-neutral.
 * When the box is wider than the space available it pins to the start margin
 * (the element's own max-width handles the overflow).
 */
export function clampInset(
  desiredInset: number,
  boxSize: number,
  viewportSize: number,
  margin: number,
): number {
  const max = Math.max(margin, viewportSize - boxSize - margin);
  return Math.min(Math.max(desiredInset, margin), max);
}

/**
 * A measured box in LOGICAL terms. `nearEdge`/`farEdge` (the DOMRect's left and
 * right) rather than left/right for the same reason `inlineStartOffset` takes
 * them that way: these helpers are where RTL is reasoned about, and naming a
 * physical side here would be the first step back to a layer that mirrors wrong.
 */
export interface AnchorBox {
  top: number;
  bottom: number;
  nearEdge: number;
  farEdge: number;
  width: number;
  height: number;
}
