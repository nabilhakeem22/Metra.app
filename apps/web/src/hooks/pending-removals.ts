// Every deferred delete still waiting for its Undo toast to close, or already
// sent and not yet answered by the server, app-wide.
// A whole-document action (issuing a BOQ, opening its costed copy) and signing
// out must not run while one is pending: the server would see a document the
// studio already changed, or the delete would arrive without a session. They
// call `flushPendingRemovals()` first, which commits every pending delete now
// and closes its Undo toast in the same step.

/** Resolves true when every delete it committed was accepted by the server. */
type Flush = () => Promise<boolean>;

const flushers = new Set<Flush>();
const pendingCounts = new Map<Flush, () => number>();

/** Called by useUndoableRemoval for as long as it is mounted. */
export function registerPendingRemovals(flush: Flush, pendingCount: () => number): () => void {
  flushers.add(flush);
  pendingCounts.set(flush, pendingCount);
  return () => {
    flushers.delete(flush);
    pendingCounts.delete(flush);
  };
}

export function hasPendingRemovals(): boolean {
  return [...pendingCounts.values()].some((count) => count() > 0);
}

/**
 * Commit every pending delete now and wait for the server to answer each,
 * including the deletes that were already on their way.
 * False when any was refused: that row is back on screen with its error, so a
 * whole-document action should stop rather than run on a document that still
 * holds it.
 */
export async function flushPendingRemovals(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((flush) => flush()));
  return results.every(Boolean);
}
