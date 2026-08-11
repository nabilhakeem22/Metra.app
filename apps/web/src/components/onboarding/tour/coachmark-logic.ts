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
