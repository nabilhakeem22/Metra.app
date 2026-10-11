import type { StudioDocumentComment } from './document-comments';

// PURE and CLIENT-SAFE. The studio's own just-saved reply as its thread panel
// shows it when the re-read after the reply fails (Round D second fix round,
// F3): the reply was saved, so it must not vanish and invite a duplicate. The
// next successful read replaces it with the stored row.

let sentReplyCount = 0;

export function ownStudioReply(body: string): StudioDocumentComment {
  sentReplyCount += 1;
  return {
    id: `sent-${sentReplyCount}`,
    channel: 'staff',
    authorUserId: null,
    authorName: null,
    body,
    createdAt: new Date(),
  };
}
