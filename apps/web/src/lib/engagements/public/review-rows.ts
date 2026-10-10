// The client's decisions on file in an UNTRUSTED delivery snapshot (Round C,
// 0058): the design decision of the current render round. PURE and
// client-safe; anything malformed reads as "nothing on file" (null).
import { isoInstant } from './snapshot-values';
import type { PublicDelivery } from './types';

const DESIGN_DECISION_KINDS = ['approved', 'changes_requested'] as const;

/** The design decision on file, or null unless both its kind and its instant are usable. */
export function parseDesignDecision(raw: unknown): PublicDelivery['designDecision'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kind = DESIGN_DECISION_KINDS.find((candidate) => candidate === row.kind);
  const at = isoInstant(row.at);
  return kind && at ? { kind, at } : null;
}
