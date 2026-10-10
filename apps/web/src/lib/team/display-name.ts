// How a member's self-chosen display name may appear in a security message
// (Round C, C8 fix round S1). PURE and CLIENT-SAFE. A display name is whatever
// the member typed into their profile, so it is shown only as a short label
// next to their verified email, never as the identity itself: clipped, on one
// line, with no link and no control or format character, so it cannot carry a
// second sentence ("..., approved, no action needed") or a URL into an alert.
import { strippedText } from '@/lib/org/printable-text';

/** The longest name shown, in characters. */
export const DISPLAY_NAME_MAX_CHARS = 60;

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S*/gi;
const CONTROL_OR_LINE_BREAK = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** The name as an alert shows it, or null when nothing readable is left. */
export function safeDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = strippedText(raw)
    .replace(URL_LIKE, ' ')
    .replace(CONTROL_OR_LINE_BREAK, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const characters = [...cleaned];
  if (characters.length === 0) return null;
  return characters.length > DISPLAY_NAME_MAX_CHARS
    ? `${characters.slice(0, DISPLAY_NAME_MAX_CHARS - 1).join('').trimEnd()}…`
    : cleaned;
}

/** A member as a security message names them: verified email, cleaned display name. */
export interface ActorIdentity {
  name: string | null;
  email: string | null;
}

/** "Name (email)", the email alone, or null: the email is the identity, the name only a label. */
export function actorLabel({ name, email }: ActorIdentity): string | null {
  if (email && name) return `${name} (${email})`;
  return email ?? null;
}
