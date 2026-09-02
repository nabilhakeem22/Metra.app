import 'server-only';
// Client Deliverables, Step 2 — the session-less COMMENT-THREAD half of the client
// delivery portal. Split out of ./public.ts, which had grown to three concerns
// behind one filename: the delivery snapshot, the action/payment-claim writers, and
// this. Same trust model as its sibling — the raw token is sha256-hashed here (never
// sent to the DB in the clear, never logged), the SECURITY DEFINER token SDF is the
// authorization, and a document id is only ever a FILTER inside a delivery the token
// already proved.
//
// ADVISORY: a comment moves no state, opens no change order and clears no guard.
// The stage approve / request-changes buttons remain the only way to move anything.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withRequestDb } from '@/lib/db/client';
import { isUuid } from '@/lib/uuid';
import type { DeliveryActionError } from './public';

/** sha256 of the raw share token — the DB only ever sees the hash. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

/** One message in a document thread, as the CLIENT sees it. A staff reply carries
 *  no author name — the client sees "the studio", never which member wrote it. */
export interface PublicDocumentComment {
  id: string;
  channel: 'client' | 'staff';
  authorName: string | null;
  body: string;
  createdAt: string | null;
}

/** One raw thread row from the comments SDF. */
interface DocumentCommentRow {
  id: string;
  channel: 'client' | 'staff';
  author_name?: string | null;
  body: string;
  created_at?: string | null;
}

/**
 * A thread row is renderable only when it carries the three fields the portal
 * dereferences: a non-empty `id`, a known `channel`, and a non-blank `body`.
 * Anything else (a null hole, a stray shape, a channel added to the DB but not yet
 * mapped) is dropped — never rendered — so a malformed row can neither crash the
 * thread nor render an empty bubble. Same defensive posture as isRenderableDocument.
 */
function isRenderableComment(row: unknown): row is DocumentCommentRow {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    (candidate.channel === 'client' || candidate.channel === 'staff') &&
    typeof candidate.body === 'string' &&
    candidate.body.trim().length > 0
  );
}

/**
 * Session-less (Client Deliverables Step 2): read ONE released document's comment
 * thread by its RAW share token. Mirrors getDeliveryByToken — sha256-hash the token
 * (never sent in the clear, never logged) and run the SECURITY DEFINER read SDF.
 *
 * The document id is only a FILTER inside the delivery the token already proved, so
 * every failure (a forged uuid, another delivery's document, an unreleased document,
 * an unknown/expired token, an empty thread) returns the SAME empty array — no
 * oracle. A thrown read degrades to `[]` too: a thread that cannot be loaded reads
 * as empty rather than breaking the portal around it.
 */
export async function getDeliveryDocumentCommentsByToken(
  rawToken: string,
  documentId: string,
): Promise<PublicDocumentComment[]> {
  if (!rawToken?.trim() || !isUuid(documentId)) return [];
  const hash = hashToken(rawToken.trim());
  try {
    const rows = (await withRequestDb((db) =>
      db.execute(
        sql`select public.app_delivery_document_comments_by_token(
          ${hash}, ${documentId}::uuid
        ) as thread`,
      ),
    )) as unknown as Array<{ thread: unknown }>;
    const thread = rows[0]?.thread;
    if (!Array.isArray(thread)) return [];
    return thread.filter(isRenderableComment).map((row) => ({
      id: row.id,
      channel: row.channel,
      authorName: row.author_name?.trim() || null,
      body: row.body,
      createdAt: row.created_at ?? null,
    }));
  } catch {
    // Token-free breadcrumb only — never the raw token, the id, or any message body.
    console.error('delivery thread read failed');
    return [];
  }
}

/** Coded outcomes of a client comment. `too_many` is the SDF's flood ceiling — a
 *  "try again in a bit", not something the client did wrong. `empty` never reaches
 *  the DB: a blank message is rejected in TS. */
export type DeliveryCommentError = DeliveryActionError | 'too_many' | 'empty';

export interface DeliveryCommentResult {
  ok: boolean;
  error?: DeliveryCommentError;
}

/**
 * Session-less (Client Deliverables Step 2): APPEND one client message to a released
 * document's thread by RAW share token. Mirrors recordDeliveryActionByToken — hash
 * the token (never logged), run the SECURITY DEFINER write SDF, map its status code.
 *
 * ADVISORY: the SDF writes one row into an append-only table. It moves no state,
 * opens no change order and touches no money — a comment is NOT a revision request,
 * and the stage buttons remain the only path to one, deliberately, so commenting can
 * never leave either side stuck. NOT idempotent, unlike the respond/claim writers:
 * two identical messages are two messages, because that is what a conversation is.
 */
export async function addDeliveryCommentByToken(
  rawToken: string,
  input: {
    documentId: string;
    body: string;
    actorName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<DeliveryCommentResult> {
  if (!rawToken?.trim()) return { ok: false, error: 'token_invalid' };
  // The uuid is validated BEFORE the DB so a malformed id can never reach the cast.
  if (!isUuid(input.documentId)) return { ok: false, error: 'token_invalid' };
  if (!input.body?.trim()) return { ok: false, error: 'empty' };
  const hash = hashToken(rawToken.trim());
  const rows = (await withRequestDb((db) =>
    db.execute(sql`select public.app_delivery_comment_by_token(
      ${hash}, ${input.documentId}::uuid, ${input.body}, ${input.actorName ?? null},
      ${input.ip ?? null}, ${input.userAgent ?? null}
    ) as code`),
  )) as unknown as Array<{ code: string }>;
  switch (rows[0]?.code) {
    case 'ok':
      return { ok: true };
    case 'too_many':
      return { ok: false, error: 'too_many' };
    case 'expired':
      return { ok: false, error: 'token_expired' };
    case 'not_active':
      return { ok: false, error: 'not_active' };
    default:
      return { ok: false, error: 'token_invalid' };
  }
}
