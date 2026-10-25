// Which outbox ops wait on which (Stage 3 site app, plan C2). PURE, CLIENT-SAFE.
//
// An op waits while an op it names by key is still in the outbox: a visit's
// photos, materials, notes and check-out wait for its check-in, a void for the
// entry it voids, and a material for the photo it shows. A sent op leaves the
// outbox, so a parent sent in an earlier session never blocks anything.
//
// The first two are HARD: the op means nothing without its parent, so
// discarding the parent discards it. The photo of a material is SOFT (the
// photo is optional on a material, FK SET NULL): discarding the photo keeps
// the delivery and only drops its photo.
import type { OutboxRecord, SiteOp } from './types';

/** The keys of the ops `op` cannot exist without. */
export function hardPrerequisiteKeys(op: SiteOp): string[] {
  switch (op.kind) {
    case 'check_in':
      return [];
    case 'check_out':
    case 'photo':
    case 'note':
    case 'material':
      return [op.visitKey];
    case 'void':
      return [op.target.key];
  }
}

/** The keys of the ops `op` cannot be sent before: its hard prerequisites, and a material's photo. */
export function prerequisiteKeys(op: SiteOp): string[] {
  const hard = hardPrerequisiteKeys(op);
  return op.kind === 'material' && op.photoKey ? [...hard, op.photoKey] : hard;
}

/** The blobs (photo copies kept in IndexedDB) an op owns. */
export function blobIdsOf(op: SiteOp): string[] {
  return op.kind === 'photo' ? [op.displayBlobId, op.thumbBlobId] : [];
}

export interface DiscardPlan {
  /** The records to delete. */
  seqs: number[];
  /** The blobs to delete with them. */
  blobIds: string[];
  /** Records kept but rewritten: a material that showed a discarded photo, now without it. */
  rewritten: OutboxRecord[];
}

/** `discarded` and every record of its user that hard-depends on it, directly or through another. */
function hardDependentsOf(sameUser: readonly OutboxRecord[], discarded: OutboxRecord): Set<number> {
  const seqs = new Set([discarded.seq]);
  const keys = new Set([discarded.op.key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of sameUser) {
      if (seqs.has(record.seq)) continue;
      // A record carrying a discarded key is a twin: the same op stored twice.
      if (keys.has(record.op.key) || hardPrerequisiteKeys(record.op).some((key) => keys.has(key))) {
        seqs.add(record.seq);
        keys.add(record.op.key);
        grew = true;
      }
    }
  }
  return seqs;
}

/** A kept material that showed one of the removed photos, without that photo; null for any other record. */
function withoutRemovedPhoto(record: OutboxRecord, removedKeys: ReadonlySet<string>): OutboxRecord | null {
  if (record.op.kind !== 'material' || record.op.photoKey === undefined || !removedKeys.has(record.op.photoKey)) return null;
  const { photoKey: _discardedPhoto, ...material } = record.op;
  return { ...record, op: material };
}

/**
 * What discarding one record does: it removes the record, every record of the
 * same user that hard-depends on it and their blobs (a child left behind would
 * wait for ever on a parent that will never be sent), and it unlinks a kept
 * material from a removed photo, so the delivery is still sent.
 */
export function discardPlan(records: readonly OutboxRecord[], seq: number): DiscardPlan {
  const discarded = records.find((record) => record.seq === seq);
  if (!discarded) return { seqs: [], blobIds: [], rewritten: [] };
  const sameUser = records.filter((record) => record.userId === discarded.userId).sort((a, b) => a.seq - b.seq);
  const removedSeqs = hardDependentsOf(sameUser, discarded);
  const removed = sameUser.filter((record) => removedSeqs.has(record.seq));
  const removedKeys = new Set(removed.map((record) => record.op.key));
  const kept = sameUser.filter((record) => !removedSeqs.has(record.seq));
  return {
    seqs: removed.map((record) => record.seq),
    blobIds: [...new Set(removed.flatMap((record) => blobIdsOf(record.op)))],
    rewritten: kept.flatMap((record) => withoutRemovedPhoto(record, removedKeys) ?? []),
  };
}

/**
 * The records of `userId` that wait on themselves: a self-reference or a
 * dependency cycle, in seq order. Well-formed ops never form one; a malformed
 * op that does would otherwise stay queued for ever.
 */
export function recordsOnDependencyCycle(records: readonly OutboxRecord[], userId: string): OutboxRecord[] {
  const queue = records.filter((record) => record.userId === userId).sort((a, b) => a.seq - b.seq);
  const byKey = new Map<string, OutboxRecord[]>();
  for (const record of queue) byKey.set(record.op.key, [...(byKey.get(record.op.key) ?? []), record]);
  const prerequisitesOf = (record: OutboxRecord) => prerequisiteKeys(record.op).flatMap((key) => byKey.get(key) ?? []);
  const waitsOnItself = (start: OutboxRecord) => {
    const visited = new Set<number>();
    const pending = prerequisitesOf(start);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (next.seq === start.seq) return true;
      if (visited.has(next.seq)) continue;
      visited.add(next.seq);
      pending.push(...prerequisitesOf(next));
    }
    return false;
  };
  return queue.filter(waitsOnItself);
}
