// What a comment on a document must have: words, and no more than the thread
// holds. Pure and client-safe: the studio's reply box and the client's comment
// box check it on Send, and both writers again before the database.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean, countCharacters } from '@/lib/validation/text';

export const COMMENT_FIELDS = ['body'] as const;
export type CommentField = (typeof COMMENT_FIELDS)[number];

/** The longest comment, in characters: the table's CHECK (0037) and the SDF. */
export const COMMENT_MAX = 2000;

/** A body that is not a string (a direct invocation) is an empty one. */
export function commentFieldErrors(body: unknown): FieldErrors<CommentField> {
  const text = typeof body === 'string' ? clean(body) : null;
  if (!text) return { body: { code: 'required' } };
  if (countCharacters(text) > COMMENT_MAX) return { body: { code: 'too_long', params: { max: COMMENT_MAX } } };
  return {};
}
