// What the studio types when it records a change order's client decision made
// on paper: the decision, the day (required, not after today in Cairo; the
// core also refuses a day before the issue, which only it knows) and an
// optional note. PURE and CLIENT-SAFE: the dialog checks it on Save, the core
// again on arrival.
import type { FieldErrors } from '@/lib/actions/field-errors';
import { readDayUpToToday } from '@/lib/validation/day-field';
import { readFields, readOptionalText, type FieldRead } from '@/lib/validation/field-rules';

export const PAPER_DECISION_FIELDS = ['decision', 'decidedOn', 'note'] as const;
export type PaperDecisionField = (typeof PAPER_DECISION_FIELDS)[number];

export const PAPER_DECISIONS = ['approve', 'reject'] as const;
export type PaperDecision = (typeof PAPER_DECISIONS)[number];

/** The note's cap: the same 500 characters as a paper signature's note. */
const MAX_PAPER_DECISION_NOTE_CHARS = 500;

export interface TypedPaperDecision {
  decision?: unknown;
  decidedOn?: unknown;
  note?: unknown;
}

/** One of the two answers a client can give; anything else is no answer yet. */
function readDecision(raw: unknown): FieldRead<PaperDecision> {
  return (PAPER_DECISIONS as readonly unknown[]).includes(raw)
    ? { ok: true, value: raw as PaperDecision }
    : { ok: false, error: { code: 'required' } };
}

/** `todayInCairo` is `YYYY-MM-DD`: the Cairo day decides "today", never UTC. */
export function readPaperDecision(input: TypedPaperDecision, todayInCairo: string) {
  return readFields({
    decision: readDecision(input.decision),
    decidedOn: readDayUpToToday(input.decidedOn, todayInCairo),
    note: readOptionalText(typeof input.note === 'string' ? input.note : null, MAX_PAPER_DECISION_NOTE_CHARS),
  });
}

/** The dialog's pre-check: the same rules, as the refusals under each box. */
export function paperDecisionFieldErrors(
  input: TypedPaperDecision,
  todayInCairo: string,
): FieldErrors<PaperDecisionField> {
  const read = readPaperDecision(input, todayInCairo);
  return read.ok ? {} : read.errors;
}
