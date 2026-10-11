import type { PublicDocumentComment } from './public-comments';

// The client portal's comment-thread read, as the browser receives it. PURE and
// CLIENT-SAFE.
//
// A read the per-link read budget refused is NOT an empty thread (Round D fix
// F1): showing it as "No messages yet" hid the studio's replies and the
// client's own just-sent message, which invited a duplicate post. So the server
// action answers a distinct marker, and the portal turns it into a rejection
// the shared thread hook already handles: the generic error, `loaded` left
// false, and a fresh read on the next open. Every OTHER failure (a forged id, a
// revoked link, a database error) is still the same empty array, so the read
// stays no oracle about documents.

/** A thread read the per-link read budget refused. */
export interface ThreadReadRefused {
  refused: true;
}

export type PortalThreadRead = PublicDocumentComment[] | ThreadReadRefused;

export const THREAD_READ_REFUSED: ThreadReadRefused = { refused: true };

/** The messages of a read; a refused read rejects instead of reading as empty. */
export function threadMessagesOrThrow(read: PortalThreadRead): PublicDocumentComment[] {
  if (Array.isArray(read)) return read;
  throw new Error('comment thread read refused');
}

let sentCommentCount = 0;

/**
 * The client's own message as the thread shows it when the re-read after a
 * successful send fails: no stored id and no date. The next successful read
 * replaces it with the stored row.
 */
export function ownSentComment(body: string): PublicDocumentComment {
  sentCommentCount += 1;
  return { id: `sent-${sentCommentCount}`, channel: 'client', authorName: null, body, createdAt: null };
}
