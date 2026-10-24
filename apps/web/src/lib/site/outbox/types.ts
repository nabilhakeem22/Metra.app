// The site app's local outbox (Stage 3, plan C2): every write the engineer makes
// is an op kept on the phone until the server has it. PURE types, CLIENT-SAFE.
//
// Each op carries a client-made uuid `key`, and the server dedupes on it
// (`unique (org_id, client_key)`, answering `already`), so sending one op twice
// never records it twice. A child op names its visit (and a material its photo,
// a void its target) by that key, never by a server id: the parent may not have
// reached the server yet.
import type { MarketUnit } from '@metra/db';
import type { PresignedPair } from '../presigned-pair';
import type { LocationReading } from '../presence';

/** Runtime-enumerable, as SITE_PRESENCES: the catalogue test proves each has its label. */
export const SITE_NOTE_KINDS = ['progress', 'issue', 'request'] as const;

export type SiteNoteKind = (typeof SITE_NOTE_KINDS)[number];

export type SitePhotoSource = 'camera' | 'gallery';

/** Where a photo op has got to: presign, PUT each copy, then confirm. Each step is saved before the next. */
export type PhotoUploadStep = 'presign' | 'put_display' | 'put_thumb' | 'confirm';

export interface PhotoMeta {
  displayBytes: number;
  thumbBytes: number;
  width: number;
  height: number;
  /** ISO instant, device clock (the file's time). */
  takenAt: string;
  source: SitePhotoSource;
  caption?: string;
}

export type SiteOp =
  | {
      kind: 'check_in';
      key: string;
      projectId: string;
      checkedInAt: string;
      location: LocationReading;
      noLocationReason?: string;
    }
  | { kind: 'check_out'; key: string; visitKey: string; checkedOutAt: string }
  | {
      kind: 'photo';
      key: string;
      visitKey: string;
      displayBlobId: string;
      thumbBlobId: string;
      meta: PhotoMeta;
      step: PhotoUploadStep;
      upload?: PresignedPair;
    }
  | {
      kind: 'material';
      key: string;
      visitKey: string;
      description: string;
      /** The quantity as typed, already rewritten to Latin digits; the server parses it strictly. */
      qty: string;
      unit: MarketUnit;
      contractId?: string;
      contractLineId?: string;
      supplier?: string;
      note?: string;
      photoKey?: string;
    }
  | { kind: 'note'; key: string; visitKey: string; noteKind: SiteNoteKind; body: string }
  | { kind: 'void'; key: string; target: { kind: 'photo' | 'material' | 'note'; key: string } };

/**
 * queued: waits its turn (or its backoff). needs_attention: the server refused
 * it; it stays until the engineer discards it. paused_auth: the session was
 * refused (401); the whole queue waits for a new sign-in.
 */
export const OUTBOX_STATES = ['queued', 'needs_attention', 'paused_auth'] as const;

export type OutboxState = (typeof OUTBOX_STATES)[number];

/** The last failed attempt: the HTTP status (0 when the request never got an answer) and its code. */
export interface OutboxError {
  status: number;
  code: string;
}

export interface OutboxRecord {
  /** IndexedDB autoIncrement key: the order the engineer made the ops in. */
  seq: number;
  orgId: string;
  userId: string;
  op: SiteOp;
  state: OutboxState;
  /** Failed attempts so far. */
  attempts: number;
  /** Epoch ms before which the op is not sent again. */
  nextAttemptAt: number;
  lastError?: OutboxError;
}
