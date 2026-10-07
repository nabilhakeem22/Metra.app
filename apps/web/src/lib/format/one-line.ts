// Studio-typed text (a delivery title, a client or studio name) going into a
// place that is ONE line: an email subject, a WhatsApp message's greeting.
// PURE and CLIENT-SAFE. No length limit exists on those columns, and a line
// break in a subject is at best a rejected email, so every such value is
// flattened and capped here before it is interpolated.

/** Delivery titles in a subject or a label. */
export const TITLE_MAX_CHARS = 120;
/** Client and studio names in a greeting or a subject. */
export const NAME_MAX_CHARS = 80;

/**
 * C0/C1 controls (CR, LF, TAB included), the line and paragraph separators,
 * the zero-width characters, the bidi embeddings, overrides and isolates (an
 * RLO in a name would reverse the rest of a subject line) and the BOM. A
 * predicate over code points, like lib/files/safe-name.ts, because a regex
 * class spelling out the C0 range is a `no-control-regex` error.
 */
function isBreakingOrInvisible(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  if (code === 0x2028 || code === 0x2029 || code === 0xfeff) return true;
  if (code >= 0x200b && code <= 0x200f) return true;
  if (code >= 0x202a && code <= 0x202e) return true;
  return code >= 0x2066 && code <= 0x2069;
}

/**
 * One line of at most `maxChars` characters (code points, so an emoji or an
 * Arabic letter is never split in half): controls become spaces, runs of
 * white space collapse, and an over-long value ends in an ellipsis.
 */
export function oneLine(value: string | null | undefined, maxChars: number): string {
  const flat = Array.from(value ?? '', (character) => (isBreakingOrInvisible(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(flat);
  if (chars.length <= maxChars) return flat;
  return `${chars.slice(0, maxChars - 1).join('').trimEnd()}…`;
}
