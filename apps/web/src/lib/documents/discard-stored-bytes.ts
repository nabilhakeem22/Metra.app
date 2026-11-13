import 'server-only';
// What follows a document row out of the database: its bytes in Storage. Split
// out of ./core.ts, which gates and deletes the row; this file only cleans up
// after a delete that has already committed.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { cfExecutionContext, isCloudflareRuntime } from '@/lib/cf/context';
import {
  STORAGE_CLEANUP_TIMEOUT_MS,
  withDeadline,
} from '@/lib/http/deadlines';
import { removeStoredObject } from '@/lib/storage/objects';

/** Where one deleted document's bytes live, so they can follow the row. */
export interface DeletedObject {
  bucket: string;
  objectKey: string;
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
export async function discardStoredBytes(deleted: DeletedObject | undefined): Promise<void> {
  if (!deleted) return;
  // The catch is attached HERE, to the removal itself, so the promise handed to
  // waitUntil can never reject — and so a failure that lands after the deadline
  // still leaves its breadcrumb instead of becoming an unhandled rejection.
  const removal = removeStoredObject(deleted.bucket, deleted.objectKey).catch(
    (error: unknown) => {
      console.error('document object remove failed', {
        ...deleted,
        error: loggableFailure(error),
      });
    },
  );
  keepAlivePastResponse(removal);
  try {
    await withDeadline(removal, STORAGE_CLEANUP_TIMEOUT_MS, 'storage cleanup');
  } catch (error) {
    // `removal` never rejects (its catch is above), so the only thing that can
    // land here is the deadline: the response stops waiting, the removal has
    // NOT failed — on Workers it is still running under waitUntil. Say that,
    // rather than logging a failure the breadcrumb above may never confirm.
    console.warn('document object remove still running past the cleanup deadline', {
      ...deleted,
      deadlineMs: STORAGE_CLEANUP_TIMEOUT_MS,
      error: loggableFailure(error),
    });
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
    console.warn('discardStoredBytes: waitUntil unavailable', loggableFailure(error));
  }
}
