// What the client SAW when they confirmed a review act (fix round F1/F2, S1).
// PURE and CLIENT-SAFE: the page computes it from the props it rendered, the
// server action computes it again from a fresh read of the same snapshot right
// before the write, and the act goes ahead only when the two agree.
//
// A TS-ONLY GUARD, BY DESIGN FOR NOW. The snapshot does not expose the issuance
// instants (rom_issued_at, renders_ready_at), so this compares what the client
// can see instead: the band's figures, and the render round as the instant of
// the newest move into final approval (the transaction that stamps
// renders_ready_at, executor side effect captureRenderManifest) plus the
// renders shared. It narrows the race to the gap between that read and the
// write; the next database step closes it under the row lock (the plan's
// "expected issuance" argument on app_delivery_respond_by_token).
import type { PublicDelivery } from './public/types';

export interface ReviewSeen {
  /** The budget band the dialog showed, or null when none was shown. */
  band: string | null;
  /** The render round the design hero showed. */
  round: string;
}

/** Longest fingerprint accepted from a browser (60 entries' instants and 200 ids fit easily). */
const SEEN_MAX_CHARS = 10_000;

/** The issued band as the client reads it: its two figures, or null with none. */
export function bandSeenOf(delivery: Pick<PublicDelivery, 'rom'>): string | null {
  const rom = delivery.rom;
  return rom && (rom.low || rom.high) ? `${rom.low ?? ''}..${rom.high ?? ''}` : null;
}

/** The render round: when the final renders were last issued, and which renders are shared. */
export function roundSeenOf(delivery: Pick<PublicDelivery, 'timeline' | 'documents'>): string {
  const issued = delivery.timeline.find((entry) => entry.type === 'stage' && entry.stageKey === 'finalApproval');
  const renders = delivery.documents
    .filter((document) => document.category === 'render')
    .map((document) => document.id)
    .sort()
    .join(',');
  return `${issued?.at ?? ''}|${renders}`;
}

export function reviewSeenOf(delivery: Pick<PublicDelivery, 'rom' | 'timeline' | 'documents'>): ReviewSeen {
  return { band: bandSeenOf(delivery), round: roundSeenOf(delivery) };
}

const boundedString = (value: unknown): value is string => typeof value === 'string' && value.length <= SEEN_MAX_CHARS;

/** What a browser sent as "seen", or null when it is not that shape (refused, never trusted). */
export function parseReviewSeen(raw: unknown): ReviewSeen | null {
  if (!raw || typeof raw !== 'object') return null;
  const { band, round } = raw as Record<string, unknown>;
  if (!boundedString(round) || !(band === null || boundedString(band))) return null;
  return { band, round };
}

/** A band the browser sent on its own (the budget card), or undefined when it is not one. */
export function parseBandSeen(raw: unknown): string | null | undefined {
  return raw === null || boundedString(raw) ? raw : undefined;
}
