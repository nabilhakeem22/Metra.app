import 'server-only';
// Reading and deleting a document that is already stored. The UPLOAD lives in
// ./upload.ts: it writes no row and therefore takes a different shape.
import { files, type MetraDb } from '@metra/db';
import { and, eq } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { cfExecutionContext, isCloudflareRuntime } from '@/lib/cf/context';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { safeDownloadName } from '@/lib/files/safe-name';
import {
  STORAGE_CLEANUP_TIMEOUT_MS,
  withDeadline,
} from '@/lib/http/deadlines';
import { getSignedUrl, removeStoredObject } from '@/lib/storage';
import type { DocumentEntitySpec } from './entities';

/**
 * The file id, IF it exists in this org and belongs to THIS entity.
 *
 * The `files.entity` filter is the cross-ENTITY guard: a project file's id handed
 * to a client surface finds no row, so a client-document endpoint can never mint
 * a URL for an unrelated in-org file. RLS is the cross-ORG half. The delete
 * carries the same two predicates in its own `where` — see below.
 */
async function ownedDocument(
  tx: MetraDb,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<{ id: string; originalName: string | null } | undefined> {
  const [owned] = await tx
    .select({ id: files.id, originalName: files.originalName })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.entity, spec.entity)))
    .limit(1);
  return owned;
}

/**
 * A signed download URL for one document (org-scoped).
 *
 * Refused for a file of the wrong entity or another org — see `ownedDocument`.
 *
 * SIGNED AS AN ATTACHMENT, always. A signed URL with no download name is served
 * INLINE, so an uploaded `Invoice.html` — the content type comes verbatim from
 * the uploader's browser — rendered as a page on the Supabase project origin and
 * executed there: in-org phishing under a URL that looks like the firm's own
 * storage. `safeDownloadName` is the client portal's extension allowlist, so
 * `.html`/`.svg` lose the extension and every document is saved, not rendered.
 *
 * The NOT-FOUND answer is decided above, by `ownedDocument`, so what the catch
 * holds is a dependency failure — a Storage 5xx, a timeout, a bad key (or,
 * vanishingly, a row deleted between the two reads). Answering `invalid` made an
 * outage indistinguishable from a deleted file, on screen ("that no longer
 * exists") and in the log, which said nothing. It logs the error and answers
 * `generic`, so on-call can tell "Storage is down" from "this id is junk".
 */
export async function getDocumentUrlCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<ActionResult & { url?: string }> {
  if (!can(ctx.role, spec.readCapability, 'read')) return err('forbidden');
  const owned = await withOrgContext(ctx, (tx) =>
    ownedDocument(tx, spec, fileId),
  );
  if (!owned) return err('invalid');
  try {
    const url = await getSignedUrl(ctx, fileId, {
      download: safeDownloadName(owned.originalName),
    });
    return { ok: true, url };
  } catch (error) {
    console.error('document url mint failed', { fileId, entity: spec.entity, error });
    return err('generic');
  }
}

/** Where one deleted document's bytes live, so they can follow the row. */
interface DeletedObject {
  bucket: string;
  objectKey: string;
}

/**
 * Delete one document row, then its bytes.
 *
 * Over `mutateInOrg` — the house spine — rather than a hand-rolled
 * `withOrgContext` + `recordAudit`: the capability is checked before the
 * transaction opens, a thrown `ActionError` becomes its coded failure, and an
 * ambiguous outcome (write deadline, lock timeout, dropped socket) surfaces as
 * `uncertain` instead of as a flat success. That last one is the reason: the
 * previous shape returned `{ ok: true }` from inside the callback, so a
 * connection dropped after the DELETE but before COMMIT would have been reported
 * to the studio as a deleted file that is still there.
 *
 * The DELETE carries the cross-entity guard in its own `where` and RETURNS the
 * row it removed, so one statement both gates and reports: no row back means the
 * file is another org's (RLS), another entity's, or already gone — `invalid`,
 * before any audit entry is written.
 */
export async function deleteDocumentCore(
  ctx: OrgContext,
  spec: DocumentEntitySpec,
  fileId: string,
): Promise<ActionResult> {
  const deleted = await mutateInOrg(
    ctx,
    { capability: spec.writeCapability, action: 'create' },
    async (tx, audit) => {
      const [removed] = await tx
        .delete(files)
        .where(and(eq(files.id, fileId), eq(files.entity, spec.entity)))
        .returning({ bucket: files.bucket, objectKey: files.objectKey });
      if (!removed) fail('invalid');
      await audit({
        entity: 'file',
        entityId: fileId,
        action: 'delete',
        before: null,
        after: null,
      });
      return removed;
    },
  );
  if (!deleted.ok) return err(deleted.error ?? 'generic');
  await discardStoredBytes(deleted.data);
  // The `data` the spine carried is the object key. It is server-side plumbing,
  // not an answer, and this is a server ACTION's return value — so it stops here.
  return { ok: true };
}

/**
 * Delete the bytes behind a document that is already gone from the database.
 *
 * AFTER the transaction commits, and best-effort. Nothing in the product deleted
 * a stored object at all, so every document a studio ever deleted left its bytes
 * in the bucket forever — unreferenced, un-enumerable once the row carrying the
 * key was gone, still holding a client's drawings, and still billed for.
 *
 * It cannot run INSIDE the transaction: Storage is an HTTP dependency and the
 * row lock would be held across its outage. It cannot fail the action either —
 * the row IS deleted. A failure is logged and leaves exactly the orphan today's
 * code leaves every time.
 *
 * AND IT MUST NOT HOLD THE USER. The Storage client carries the 15s upload
 * deadline, which is the wrong budget here: the user is watching a spinner for
 * work that has already succeeded. `withDeadline` bounds the WAIT, not the
 * work — correct in this one place, because the underlying `remove` finishing
 * after we stop waiting is a success we simply did not observe, and the row is
 * gone either way. An `HttpDeadlineError` lands in the same catch as any other
 * failure and leaves the same breadcrumb.
 *
 * "NOT OBSERVED" ONLY COUNTS IF THE WORK SURVIVES. On the Workers runtime the
 * isolate is free to be torn down once the response is sent, so a `remove` still
 * in flight past the 3s deadline was not merely unobserved — it was KILLED, and
 * the orphan was permanent (the object key is unreachable from the database the
 * moment the row is deleted, and there is no reconciliation job). The removal is
 * therefore handed to `ctx.waitUntil`, which keeps the isolate alive until it
 * settles, while the request stops WAITING for it after the deadline. Two
 * different bounds for two different things.
 *
 * Off-platform (`next dev`, vitest) there is no execution context and nothing
 * tears the process down at response time, so the await is the whole story and
 * the branch is skipped.
 */
async function discardStoredBytes(deleted: DeletedObject | undefined): Promise<void> {
  if (!deleted) return;
  // The catch is attached HERE, to the removal itself, so the promise handed to
  // waitUntil can never reject — and so a failure that lands after the deadline
  // still leaves its breadcrumb instead of becoming an unhandled rejection.
  const removal = removeStoredObject(deleted.bucket, deleted.objectKey).catch(
    (error: unknown) => {
      console.error('document object remove failed', { ...deleted, error });
    },
  );
  keepAlivePastResponse(removal);
  try {
    await withDeadline(removal, STORAGE_CLEANUP_TIMEOUT_MS, 'storage cleanup');
  } catch (error) {
    console.error('document object remove failed', { ...deleted, error });
  }
}

/**
 * Ask the Workers runtime to keep the isolate alive for `work` after the
 * response. A no-op everywhere else.
 *
 * BEST-EFFORT, like the `after()` teardown in `lib/db/request-connection.ts`:
 * some OpenNext render scopes have no execution context wired, and failing to
 * defer best-effort cleanup must never fail a delete that has already committed.
 */
function keepAlivePastResponse(work: Promise<unknown>): void {
  if (!isCloudflareRuntime()) return;
  try {
    cfExecutionContext().waitUntil(work);
  } catch (error) {
    console.warn('discardStoredBytes: waitUntil unavailable', error);
  }
}
