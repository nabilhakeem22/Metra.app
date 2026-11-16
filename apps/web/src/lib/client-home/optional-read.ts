// A read the client's page can stand without (reliability R-L2): one that failed
// or is slow must not hold the page or take it down. The page then says it
// could not show that part, and offers no act on what it could not show.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';

/** How long the page waits for such a read before it goes on without it. */
export const OPTIONAL_READ_WAIT_MS = 5_000;

/** How long a document link's page (/v, /c) waits for each of its reads (reliability M1, H7 R1). */
export const LINK_DOCUMENT_WAIT_MS = 3_500;

/** What `read` answered, or null after ONE redacted log line (`failedLine`) when it failed or outlasted the wait. */
export async function optionalPageRead<T>(failedLine: string, read: Promise<T>, waitMs: number = OPTIONAL_READ_WAIT_MS): Promise<T | null> {
  try {
    if (!(await settledWithin(read, waitMs))) {
      console.error(failedLine, { name: 'OptionalReadWait', waitedMs: waitMs });
      return null;
    }
    return await read;
  } catch (error) {
    console.error(failedLine, loggableFailure(error));
    return null;
  }
}

/**
 * A document link's own read: `{ document }`, whose null is a link that shows no
 * document (the invalid-link page), or null itself when the read failed or
 * outlasted the wait, which says nothing about the link (a "refresh" notice).
 */
export function linkDocumentRead<T>(failedLine: string, read: Promise<T | null>): Promise<{ document: T | null } | null> {
  return optionalPageRead(failedLine, read.then((document) => ({ document })), LINK_DOCUMENT_WAIT_MS);
}
