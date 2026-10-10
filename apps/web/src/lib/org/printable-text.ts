// What counts as text a client can read and copy (Round C, C8 fix round F8).
// PURE and CLIENT-SAFE. 0058's printable CHECK refuses format characters and
// white-space-only values; this is stricter, so a value the app accepts always
// shows the client something: no control characters (NUL included, which
// Postgres refuses outright), no lone surrogates (which Postgres would quietly
// replace), and at least one visible character, which the blank-looking letters
// (the Braille blank, the Hangul fillers) and combining marks on their own are
// not.

/**
 * Unicode format characters (category Cf), plus 0058's own list spelled out, so
 * a runtime with an older Unicode table still strips every one the CHECK refuses.
 */
const FORMAT_CHARACTERS =
  /[\p{Cf}\u{AD}\u{600}-\u{605}\u{61C}\u{6DD}\u{70F}\u{890}-\u{891}\u{8E2}\u{180E}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{206F}\u{FEFF}\u{FFF9}-\u{FFFB}\u{110BD}\u{110CD}\u{13430}-\u{1343F}\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0001}\u{E0020}-\u{E007F}]/gu;

/** C0, DEL and C1 controls (NUL, tab, newline, NEL among them). */
const CONTROL = /\p{Cc}/u;

/** Half of a surrogate pair with no other half: not a character at all. */
const LONE_SURROGATE = /\p{Cs}/u;

/** Letters and symbols that draw nothing: the Braille blank and the Hangul fillers (alternatives,
 * not a class: two Hangul fillers in a class would read as one syllable). */
const BLANK_LOOKING = /\u{2800}|\u{115F}|\u{1160}|\u{3164}|\u{FFA0}/gu;

/** One character a reader sees: a letter, a digit, punctuation or a symbol. */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** The value with every format character removed and the edges trimmed. */
export function strippedText(raw: string): string {
  return raw.replace(FORMAT_CHARACTERS, '').trim();
}

/** Why `text` (already stripped) is not printable, or null when it is. */
export function unprintableReason(text: string): 'control' | 'invisible' | null {
  if (CONTROL.test(text) || LONE_SURROGATE.test(text)) return 'control';
  return VISIBLE.test(text.replace(BLANK_LOOKING, '')) ? null : 'invisible';
}
