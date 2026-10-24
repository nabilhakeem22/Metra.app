// Which outbox ops wait on which (Stage 3 site app, plan C2). PURE, CLIENT-SAFE.
//
// An op waits while an op it names by key is still in the outbox: a visit's
// photos, materials, notes and check-out wait for its check-in, a material
// waits for the photo it shows, a void for the entry it voids. A sent op leaves
// the outbox, so a parent sent in an earlier session never blocks anything.
import type { OutboxRecord, SiteOp } from './types';

/** The keys of the ops `op` cannot be sent before. */
export function prerequisiteKeys(op: SiteOp): string[] {
  switch (op.kind) {
    case 'check_in':
      return [];
    case 'check_out':
    case 'photo':
    case 'note':
      return [op.visitKey];
    case 'material':
      return op.photoKey ? [op.visitKey, op.photoKey] : [op.visitKey];
    case 'void':
      return [op.target.key];
  }
}

/** The blobs (photo copies kept in IndexedDB) an op owns. */
export function blobIdsOf(op: SiteOp): string[] {
  return op.kind === 'photo' ? [op.displayBlobId, op.thumbBlobId] : [];
}

export interface DiscardPlan {
  seqs: number[];
  blobIds: string[];
}

/**
 * What discarding one record removes: the record, every record of the same
 * user that waits on it (directly or through another), and their blobs. A child
 * left behind would wait for ever on a parent that will never be sent.
 */
export function discardPlan(records: readonly OutboxRecord[], seq: number): DiscardPlan {
  const discarded = records.find((record) => record.seq === seq);
  if (!discarded) return { seqs: [], blobIds: [] };
  const sameUser = records.filter((record) => record.userId === discarded.userId);
  const removed = new Map<string, OutboxRecord>([[discarded.op.key, discarded]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of sameUser) {
      if (removed.has(record.op.key)) continue;
      if (prerequisiteKeys(record.op).some((key) => removed.has(key))) {
        removed.set(record.op.key, record);
        grew = true;
      }
    }
  }
  const plan = [...removed.values()].sort((a, b) => a.seq - b.seq);
  return { seqs: plan.map((record) => record.seq), blobIds: plan.flatMap((record) => blobIdsOf(record.op)) };
}
