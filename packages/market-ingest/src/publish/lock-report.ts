// A market write that waited 3 s for a lock fails with 55P03; this adds who
// holds the locks and how to end a stuck holder to that failure.
import { sqlstateOf } from '@metra/db/sqlstate';
import { describeLockHolders } from './lock-holders';

export async function withLockHolderReport<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (sqlstateOf(error) !== '55P03') throw error;
    const report = await describeLockHolders().catch(() => 'The lock holders could not be read.');
    throw new Error(`${error instanceof Error ? error.message : String(error)} (SQLSTATE 55P03: another session holds a market lock)\n${report}`);
  }
}
