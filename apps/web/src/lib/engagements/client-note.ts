// A client's free-text note on the client page. PURE and CLIENT-SAFE: the
// portal's buttons and the portal's server actions read the same rule.

/** Characters that take up no visible room: format marks (zero-width space and
 *  joiners, the bidi marks, the word joiner) and every kind of space. */
const INVISIBLE = /[\p{Cf}\p{Z}\s]/gu;

/** The longest note stored with a client act (the SDFs cap it the same). */
export const CLIENT_NOTE_MAX = 2000;

/** True when the note has no visible character at all. Anything that is not a
 *  string (a server action is directly invokable) is no note. */
export function isBlankNote(note: unknown): boolean {
  return typeof note !== 'string' || note.replace(INVISIBLE, '') === '';
}

/** The note as it is stored: trimmed and capped, or null when it shows nothing. */
export function clientNote(note: unknown): string | null {
  return typeof note !== 'string' || isBlankNote(note) ? null : note.trim().slice(0, CLIENT_NOTE_MAX);
}
