// A read the client's page can stand without (reliability R-L2): one that failed
// or is slow must not hold the page or take it down. The page then says it
// could not show that part, and offers no act on what it could not show.
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { settledWithin } from '@/lib/async/settled-within';

/** How long the page waits for such a read before it goes on without it. */
export const OPTIONAL_READ_WAIT_MS = 5_000;

/** What `read` answered, or null after ONE redacted log line (`failedLine`) when it failed or outlasted the wait. */
export async function optionalPageRead<T>(failedLine: string, read: Promise<T>): Promise<T | null> {
  try {
    if (!(await settledWithin(read, OPTIONAL_READ_WAIT_MS))) {
      console.error(failedLine, { name: 'OptionalReadWait', waitedMs: OPTIONAL_READ_WAIT_MS });
      return null;
    }
    return await read;
  } catch (error) {
    console.error(failedLine, loggableFailure(error));
    return null;
  }
}
