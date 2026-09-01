import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { designEngagements } from './design-engagements';
import { engagementArtifacts } from './engagement-artifacts';
import { organizations } from './organizations';
import { orgScoped } from './org-scoped';
import { sameOrgFk } from './org-ref';

/**
 * Per-document comment threads (Client Deliverables, Step 2). One row per message
 * on ONE released artifact — the client asks about a specific drawing, the studio
 * replies underneath, and the whole exchange stays attached to the file instead of
 * moving to WhatsApp.
 *
 * ADVISORY BY DESIGN: a comment moves no state, opens no change order, and is NOT
 * a guard input. The client still approves / requests changes with the existing
 * stage buttons; comments only add the SPECIFICITY those buttons lack ("this
 * drawing, this detail"). Deliberately so — a blocking comment would be a second
 * competing path to the same transition and a fresh way for both sides to get
 * stuck, which is exactly the concept-stage dead-end this product already hit.
 *
 * APPEND-ONLY, like engagement_events / payment_events: roles.sql grants SELECT +
 * INSERT only, so a message can never be edited or deleted by either side. That is
 * also why "needs your reply" is DERIVED (a client message with no later staff
 * message on the same artifact) rather than stored as a read flag — a mutable
 * `seen_at` would need an UPDATE grant on an otherwise immutable ledger, and
 * "awaiting reply" is a truer signal to the studio than "someone opened it".
 *
 * `authorChannel` splits the two writers: 'staff' (an authenticated cockpit user,
 * `authorUserId` set) and 'client' (the session-less portal token path, where no
 * internal user exists — `authorUserId` is NULL and provenance is carried by
 * `authorName` / `authorIp` / `authorUserAgent`, mirroring engagement_events). A
 * CHECK enforces the load-bearing half of that split: a client message can never be
 * attributed to an internal user. Cascade delete follows the parent engagement AND
 * the artifact — a thread has no meaning without its document.
 */
export const engagementDocumentComments = pgTable(
  'engagement_document_comments',
  {
    ...orgScoped(),
    orgId: uuid('org_id')
      .notNull()
      .references((): AnyPgColumn => organizations.id, { onDelete: 'restrict' }),
    engagementId: uuid('engagement_id').notNull(),
    /** The released artifact this thread hangs off. */
    artifactId: uuid('artifact_id').notNull(),
    /** 'staff' (authenticated cockpit user) or 'client' (token portal path). */
    authorChannel: text('author_channel').notNull(),
    /** The internal author. NULL on the client path (no internal user exists). */
    authorUserId: uuid('author_user_id'),
    /** Session-less client provenance (mirrors engagement_events). */
    authorName: text('author_name'),
    authorIp: text('author_ip'),
    authorUserAgent: text('author_user_agent'),
    /** The message. Non-empty, capped at 2000 chars by a DB CHECK — the SDF and
     *  the server action both trim/cap before insert; this is the backstop. */
    body: text('body').notNull(),
  },
  (t) => [
    unique('engagement_document_comments_org_id_id_unique').on(t.orgId, t.id),
    check(
      'engagement_document_comments_channel_valid',
      sql`author_channel in ('staff', 'client')`,
    ),
    // A client message must never carry an internal user id. The converse (a staff
    // message with a null author) is deliberately NOT enforced — a future automated
    // studio reply would have no user row, and nothing reads authorUserId for authz.
    check(
      'engagement_document_comments_client_has_no_user',
      sql`author_channel <> 'client' or author_user_id is null`,
    ),
    check(
      'engagement_document_comments_body_length',
      sql`length(btrim(body)) between 1 and 2000`,
    ),
    ...sameOrgFk(t, 'engagement', designEngagements, { onDelete: 'cascade' }),
    ...sameOrgFk(t, 'artifact', engagementArtifacts, { onDelete: 'cascade' }),
    // The thread read: every message on one document, oldest first.
    index('engagement_document_comments_artifact_idx').on(t.orgId, t.artifactId, t.createdAt),
    // The cockpit's per-engagement roll-up (thread counts + awaiting-reply).
    index('engagement_document_comments_engagement_idx').on(t.orgId, t.engagementId),
  ],
);

export type EngagementDocumentComment = typeof engagementDocumentComments.$inferSelect;
export type NewEngagementDocumentComment = typeof engagementDocumentComments.$inferInsert;
