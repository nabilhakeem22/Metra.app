// The letter of a concept option: position 1 is option A, up to 4 = D. PURE and
// CLIENT-SAFE (no db, no server-only), so the portal, the studio card, the
// timeline and the notification feed all print the same letter.
//
// The POSITION is never computed here. The database letters the options (one
// SQL rule, app_concept_option_positions: released, file-bearing, A to D in the
// order the client sees them) and a choice SAVES the position it was made under
// (engagement_events.chosen_position). This only turns that number into a letter,
// and refuses anything that is not one of the four.

export const CONCEPT_LETTERS = ['A', 'B', 'C', 'D'] as const;

export type ConceptLetter = (typeof CONCEPT_LETTERS)[number];

/** Integer 1..4 -> 'A'..'D'; anything else (0, 5, 1.5, '2', null, NaN) -> null. */
export function conceptLetter(position: unknown): ConceptLetter | null {
  if (typeof position !== 'number' || !Number.isInteger(position)) return null;
  return CONCEPT_LETTERS[position - 1] ?? null;
}
