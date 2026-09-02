// Client Deliverables, Step 2 — the STUDIO half of per-document comment threads.
// The client writes through the token SDF (`app_delivery_comment_by_token`); this
// module is what the cockpit uses: read one document's thread, and reply into it.
//
// Self-contained `*Core(ctx, input)` (API-ready), gated on the §2.2
// `engagements_design` cell — `read` for the thread, `update` for a reply (the same
// cell that governs every other studio write on an engagement). The thin
// `'use server'` wrappers live in ./actions/deliverables.ts.
//
// ADVISORY: replying moves no state, opens no change order and clears no guard. A
// thread is a conversation attached to a drawing, not a step in the machine.
import {
  designEngagements,
  engagementArtifacts,
  engagementDocumentComments,
} from '@metra/db';
import { and, asc, count, eq, gt, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { isTerminal } from './states';
import { isUuid } from '@/lib/uuid';

/** Mirrors the SDF cap and the table's CHECK. */
const BODY_MAX = 2000;

/** How many messages one thread read returns. A thread is a conversation, not a
 *  feed; the cap keeps a runaway thread from turning one panel read unbounded. */
const THREAD_LIMIT = 200;

/** One message as the STUDIO sees it. Unlike the client's view this keeps the
 *  author id, so the cockpit can tell "you" from a colleague. */
export interface StudioDocumentComment {
  id: string;
  channel: string;
  authorUserId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
}

/**
 * Read ONE document's thread, oldest first. RLS scopes the read to the caller's
 * org, so a foreign artifact id simply resolves to an empty thread — the same
 * result as a document nobody has commented on. Returns `[]` on a malformed id
 * rather than throwing.
 */
export async function listDocumentCommentsCore(
  ctx: OrgContext,
  artifactId: string,
): Promise<StudioDocumentComment[]> {
  if (!isUuid(artifactId)) return [];
  return withOrgContext(ctx, async (db) =>
    db
      .select({
        id: engagementDocumentComments.id,
        channel: engagementDocumentComments.authorChannel,
        authorUserId: engagementDocumentComments.authorUserId,
        authorName: engagementDocumentComments.authorName,
        body: engagementDocumentComments.body,
        createdAt: engagementDocumentComments.createdAt,
      })
      .from(engagementDocumentComments)
      .where(eq(engagementDocumentComments.artifactId, artifactId))
      .orderBy(asc(engagementDocumentComments.createdAt))
      .limit(THREAD_LIMIT),
  );
}

export interface ReplyToDocumentInput {
  artifactId: string;
  body: string;
}

/**
 * APPEND one studio reply to a document's thread.
 *
 * Flow: gate `engagements_design`/`update` (before any tx) → uuid shape and a
 * non-blank body within the cap (`invalid`) → open the RLS tx and resolve the
 * artifact, which is therefore `invalid` when absent OR in another org → the parent
 * engagement must resolve in-org (`engagement_not_found`) and not be terminal
 * (`engagement_not_active`), matching setArtifactClientVisibilityCore → insert one
 * append-only row stamped with the acting user → audit.
 *
 * The artifact does NOT have to be client-visible: a studio note on a not-yet-shared
 * drawing is legitimate, and it becomes visible to the client exactly when the file
 * itself is released. Never throws to the client — coded ActionResult only.
 */
export async function replyToDocumentCore(
  ctx: OrgContext,
  input: ReplyToDocumentInput,
): Promise<ActionResult> {
  if (!isUuid(input.artifactId)) return { ok: false, error: 'invalid' };
  const body = input.body?.trim().slice(0, BODY_MAX) ?? '';
  if (!body) return { ok: false, error: 'invalid' };

  return mutateInOrg(
    ctx,
    { capability: 'engagements_design', action: 'update', flow: 'interior' },
    async (tx, audit) => {
      const [artifact] = await tx
        .select({
          id: engagementArtifacts.id,
          engagementId: engagementArtifacts.engagementId,
        })
        .from(engagementArtifacts)
        .where(eq(engagementArtifacts.id, input.artifactId))
        .limit(1);
      if (!artifact) fail('invalid');

      const [engagement] = await tx
        .select({ id: designEngagements.id, state: designEngagements.state })
        .from(designEngagements)
        .where(eq(designEngagements.id, artifact.engagementId))
        .limit(1);
      if (!engagement) fail('engagement_not_found');
      if (isTerminal(engagement.state)) fail('engagement_not_active');

      await tx.insert(engagementDocumentComments).values({
        orgId: ctx.orgId,
        engagementId: artifact.engagementId,
        artifactId: artifact.id,
        authorChannel: 'staff',
        authorUserId: ctx.userId,
        body,
      });

      await audit({
        entity: 'design_engagement',
        entityId: artifact.engagementId,
        action: 'update',
        after: { artifact_id: artifact.id, comment_length: body.length },
      });
    },
  );
}

/**
 * How many client messages on this engagement are still AWAITING a studio reply —
 * a client message with no staff message after it on the same document.
 *
 * DERIVED, not stored: the comments table is append-only (SELECT + INSERT grants
 * only), so there is no `seen_at` to flip. That is deliberate twice over — a read
 * flag would need an UPDATE grant on an immutable ledger, and "awaiting reply" is a
 * truer signal to the studio than "somebody opened it". Opening a thread therefore
 * does NOT clear the badge; replying does.
 *
 * Counts messages, not documents: three unanswered questions on one drawing read as
 * three, which is what the studio has to work through.
 */
export async function countAwaitingReplyCore(
  ctx: OrgContext,
  engagementId: string,
): Promise<number> {
  if (!isUuid(engagementId)) return 0;
  // The same table again, aliased, so the subquery can refer to a LATER message on
  // the same document without colliding with the outer row.
  const later = alias(engagementDocumentComments, 'later');
  const [row] = await withOrgContext(ctx, async (db) =>
    db
      .select({ n: count() })
      .from(engagementDocumentComments)
      .where(
        and(
          eq(engagementDocumentComments.engagementId, engagementId),
          eq(engagementDocumentComments.authorChannel, 'client'),
          // ...and no staff message on the SAME document after it.
          notExists(
            db
              .select({ one: sql`1` })
              .from(later)
              .where(
                and(
                  eq(later.artifactId, engagementDocumentComments.artifactId),
                  eq(later.orgId, engagementDocumentComments.orgId),
                  eq(later.authorChannel, 'staff'),
                  gt(later.createdAt, engagementDocumentComments.createdAt),
                ),
              ),
          ),
        ),
      ),
  );
  return row?.n ?? 0;
}
