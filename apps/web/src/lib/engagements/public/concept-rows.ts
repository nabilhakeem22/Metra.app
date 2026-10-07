// The concept rows of an UNTRUSTED delivery snapshot (Round B, B12): the
// lettered options, the saved choice and the client's decision on file. PURE
// and client-safe, with the same posture as ./row-guards.ts: anything malformed
// is dropped, never rendered and never sent back to the database.
import { isUuid } from '@/lib/uuid';
import { conceptLetter } from '../concept-letter';
import type { PublicDelivery } from './types';

/**
 * The concept options the client may choose between, in letter order. A row is
 * kept only when its id is a uuid (the choose call casts it) and its position
 * maps to a letter (1 to 4); a position seen twice keeps the first row. Anything
 * else, including a missing or non-array key, is dropped: a shorter list, never
 * an option the client cannot actually choose.
 */
export function parseConceptOptions(raw: unknown): PublicDelivery['conceptOptions'] {
  if (!Array.isArray(raw)) return [];
  const byPosition = new Map<number, PublicDelivery['conceptOptions'][number]>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const { id, position } = row as Record<string, unknown>;
    const letter = conceptLetter(position);
    if (typeof id !== 'string' || !isUuid(id) || letter === null) continue;
    const at = position as 1 | 2 | 3 | 4;
    if (!byPosition.has(at)) byPosition.set(at, { id, position: at, letter });
  }
  return [...byPosition.values()].sort((a, b) => a.position - b.position);
}

/** The choice and its saved letter, or null unless BOTH are usable. */
export function parseConceptChoice(id: unknown, position: unknown): PublicDelivery['conceptChoice'] {
  const letter = conceptLetter(position);
  return typeof id === 'string' && isUuid(id) && letter !== null ? { id, letter } : null;
}

const CONCEPT_DECISIONS = ['chosen', 'approved', 'changes_requested'] as const;

/** The client's concept decision on file, or null for anything else. */
export function parseConceptDecision(raw: unknown): PublicDelivery['conceptDecision'] {
  return CONCEPT_DECISIONS.find((decision) => decision === raw) ?? null;
}
