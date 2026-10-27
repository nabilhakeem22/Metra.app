// The name a client signs the execution contract with, as the browser and the
// server both read it. PURE and CLIENT-SAFE: the sign panel checks it before
// anything is sent, and the server checks it again (a direct call can send
// anything). One line: controls, bidi overrides and invisible characters
// become spaces (lib/format/one-line.ts), so an RLO in a name cannot reverse
// what the studio reads.
import { oneLine } from '@/lib/format/one-line';

/** The longest name kept, as /c keeps it. */
export const SIGNER_NAME_MAX = 120;

/** The name to sign with, one line of at most 120 characters, or null when there is none. */
export function signerNameOf(sent: unknown): string | null {
  if (typeof sent !== 'string') return null;
  return oneLine(sent, SIGNER_NAME_MAX) || null;
}
