// Outbox records for the site outbox tests: one builder per op kind, with
// readable keys. Test-only (lib/site/outbox/*.test.ts).
import type { OutboxRecord, SiteOp } from '@/lib/site/outbox/types';

export const ENGINEER = 'user-engineer';
export const OTHER_ENGINEER = 'user-other';
const ORG = 'org-a';

type OpOf<Kind extends SiteOp['kind']> = Extract<SiteOp, { kind: Kind }>;

let nextSeq = 1;

/** A queued, never-tried record for `op`, numbered in creation order. */
export function queued(op: SiteOp, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return { seq: nextSeq++, orgId: ORG, userId: ENGINEER, op, state: 'queued', attempts: 0, nextAttemptAt: 0, ...overrides };
}

export function checkIn(key: string): OpOf<'check_in'> {
  return {
    kind: 'check_in',
    key,
    projectId: 'project-1',
    checkedInAt: '2026-10-23T07:00:00Z',
    location: { status: 'fixed', lat: 30.0444, lng: 31.2357, accuracyM: 12, fixedAt: '2026-10-23T07:00:00Z' },
  };
}

export function note(key: string, visitKey: string): OpOf<'note'> {
  return { kind: 'note', key, visitKey, noteKind: 'progress', body: 'Ceramic laid in the kitchen.' };
}

export function material(key: string, visitKey: string, photoKey?: string): OpOf<'material'> {
  return { kind: 'material', key, visitKey, description: 'Cement', qty: '20', unit: 'bag', ...(photoKey ? { photoKey } : {}) };
}

export function photo(key: string, visitKey: string): OpOf<'photo'> {
  return {
    kind: 'photo',
    key,
    visitKey,
    displayBlobId: `${key}-display`,
    thumbBlobId: `${key}-thumb`,
    meta: { displayBytes: 300_000, thumbBytes: 20_000, width: 1600, height: 1200, takenAt: '2026-10-23T07:05:00Z', source: 'camera' },
    step: 'presign',
  };
}

export function checkOut(key: string, visitKey: string): OpOf<'check_out'> {
  return { kind: 'check_out', key, visitKey, checkedOutAt: '2026-10-23T12:00:00Z' };
}

export function voidOf(key: string, target: { kind: 'photo' | 'material' | 'note'; key: string }): OpOf<'void'> {
  return { kind: 'void', key, target };
}
