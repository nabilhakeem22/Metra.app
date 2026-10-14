// What a comment on a document must have: words. Pure and client-safe: the
// studio's reply box checks it on Send and replyToDocumentCore again.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { clean } from '@/lib/validation/text';

export const COMMENT_FIELDS = ['body'] as const;
export type CommentField = (typeof COMMENT_FIELDS)[number];

export function commentFieldErrors(body: string | null | undefined): FieldErrors<CommentField> {
  return clean(body) ? {} : { body: { code: 'required' } };
}
