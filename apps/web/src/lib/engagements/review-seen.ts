// What the client SAW when they confirmed a review act (Round D). PURE and
// CLIENT-SAFE: the page reads it off the props it rendered and sends it with
// the act; the server never fills it from a fresh read.
//
// THE ISSUANCES, NOT A FINGERPRINT. The snapshot carries the instant of the
// band issuance (rom.issuedAt) and of the render round (rendersIssuedAt)
// exactly as the database wrote them. The act echoes the one it answers into
// the seven-argument app_delivery_respond_by_token, which compares it with the
// row under its lock: another issuance on file answers `wrong_state` and
// nothing is written. There is no TypeScript pre-read: the database is the
// only judge, so no race is left between a check and the write.
import { issuanceStamp } from './public/snapshot-values';
import type { PublicDelivery } from './public/types';

export interface ReviewSeen {
  /** The band issuance the page showed, or null when it showed no band. */
  romIssuedAt: string | null;
  /** The render round the page showed, or null before any round (a legacy delivery). */
  rendersIssuedAt: string | null;
}

/** The band issuance the page showed, or null with no band. */
export function bandSeenOf(delivery: Pick<PublicDelivery, 'rom'>): string | null {
  return delivery.rom?.issuedAt ?? null;
}

export function reviewSeenOf(delivery: Pick<PublicDelivery, 'rom' | 'rendersIssuedAt'>): ReviewSeen {
  return { romIssuedAt: bandSeenOf(delivery), rendersIssuedAt: delivery.rendersIssuedAt };
}

/** Null, or an issuance stamp; anything else is undefined. */
function stampOrNull(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  return issuanceStamp(raw) ?? undefined;
}

/**
 * What a browser sent as "seen", or null when it is not that shape (refused,
 * never trusted). Both keys must be present; a page from before Round D sends
 * `{ band, round }`, which is refused, so it re-reads instead of acting.
 */
export function parseReviewSeen(raw: unknown): ReviewSeen | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (!Object.hasOwn(row, 'romIssuedAt') || !Object.hasOwn(row, 'rendersIssuedAt')) return null;
  const romIssuedAt = stampOrNull(row.romIssuedAt);
  const rendersIssuedAt = stampOrNull(row.rendersIssuedAt);
  if (romIssuedAt === undefined || rendersIssuedAt === undefined) return null;
  return { romIssuedAt, rendersIssuedAt };
}

/** The band issuance the budget card sent on its own, or undefined when it is not one. */
export function parseBandSeen(raw: unknown): string | null | undefined {
  return stampOrNull(raw);
}
