// PURE coachmark helpers (no DOM), so the RTL positioning + keyboard mapping are
// unit-testable without a browser env.

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
 * so it is correct in LTR and RTL alike — the viewport width is direction-neutral.
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
 * Choose the block-axis top for the card: below the anchor by `gap`, unless
 * that would overflow the viewport bottom and there is more room above — then
 * flip above. Always clamped to stay within `[margin, viewportH - cardH - margin]`.
 */
export function cardTop(
  anchorTop: number,
  anchorBottom: number,
  cardHeight: number,
  viewportHeight: number,
  gap: number,
  margin: number,
): number {
  const below = anchorBottom + gap;
  const above = anchorTop - gap - cardHeight;
  const overflowsBelow = below + cardHeight + margin > viewportHeight;
  const chosen = overflowsBelow && above >= margin ? above : below;
  const max = Math.max(margin, viewportHeight - cardHeight - margin);
  return Math.min(Math.max(chosen, margin), max);
}

export type CoachKey = 'stop' | 'next' | 'prev' | 'tab' | null;

/** Map a keydown to a coachmark action. Esc=stop, →/Enter=next, ←=prev, Tab=trap. */
export function coachmarkKey(key: string): CoachKey {
  switch (key) {
    case 'Escape':
      return 'stop';
    case 'ArrowRight':
    case 'Enter':
      return 'next';
    case 'ArrowLeft':
      return 'prev';
    case 'Tab':
      return 'tab';
    default:
      return null;
  }
}
