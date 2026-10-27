// The name a client signs the execution contract with, as the browser and the
// server both read it. PURE and CLIENT-SAFE: the sign panel checks it before
// anything is sent, and the server checks it again (a direct call can send
// anything). One line: controls, bidi overrides and invisible characters
// become spaces (lib/format/one-line.ts), so an RLO in a name cannot reverse
// what the studio reads; every other character with no glyph of its own (a
// soft hyphen, the Arabic letter mark, a Hangul filler, a tag) is dropped, and
// a name must keep at least one letter, so it can never look blank.
import { oneLine } from '@/lib/format/one-line';

/** The longest name kept, as /c keeps it. */
export const SIGNER_NAME_MAX = 120;

/** Longer than this (UTF-16 units) is no typed name: refused before any cleaning, so a huge body costs no CPU. */
const LONGEST_NAME_SENT = SIGNER_NAME_MAX * 8;

/** Characters a renderer shows nothing for (Unicode Default_Ignorable_Code_Point). */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

const LETTER = /\p{L}/u;

/** The name to sign with, one line of at most 120 characters holding a letter, or null when there is none. */
export function signerNameOf(sent: unknown): string | null {
  if (typeof sent !== 'string' || sent.length > LONGEST_NAME_SENT) return null;
  const name = oneLine(sent, SIGNER_NAME_MAX).replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return LETTER.test(name) ? name : null;
}
