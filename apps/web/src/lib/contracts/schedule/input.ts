// The payment schedule as the Schedule tab sends it, made into the rows the
// pure validator reads. PURE and CLIENT-SAFE. The action is directly invokable,
// so anything may arrive: a non-array, a row that is not an object, a value
// that is not a string. Each is said under the box it belongs to, never thrown.
import type { MilestoneBasis } from '@metra/db';
import type { FieldErrors } from '@/lib/actions/field-errors';
import { MAX_SCHEDULE_ROWS, type ScheduleRowInput } from '@/lib/execution/money/schedule';

/** The schedule's own box (the sum, the count, the basis), then each row's two. */
export const SCHEDULE_FIELD = 'milestones';
export const scheduleLabelPath = (index: number) => `milestones.${index}.label`;
export const scheduleValuePath = (index: number) => `milestones.${index}.value`;

const BASES: readonly MilestoneBasis[] = ['percent', 'amount'];

const asText = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function asBasis(value: unknown): MilestoneBasis | null {
  return BASES.find((basis) => basis === value) ?? null;
}

/** One row as typed, or null when its basis is not one of the two. */
function rowOf(raw: unknown): ScheduleRowInput | null {
  const row = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const basis = asBasis(row.basis);
  if (basis === null) return null;
  return { labelAr: asText(row.labelAr), labelEn: asText(row.labelEn), basis, value: asText(row.value) ?? '' };
}

/**
 * The rows, or the refusal of the schedule as a whole. More than 12 rows is
 * refused HERE, before any row is read, so an oversized payload costs nothing;
 * a row with no known basis is the same refusal as a mixed one.
 */
export function readScheduleRows(
  raw: unknown,
): { ok: true; rows: ScheduleRowInput[] } | { ok: false; errors: FieldErrors } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: { [SCHEDULE_FIELD]: { code: 'required' } } };
  }
  if (raw.length > MAX_SCHEDULE_ROWS) {
    return { ok: false, errors: { [SCHEDULE_FIELD]: { code: 'schedule_too_long' } } };
  }
  const rows = raw.map(rowOf).filter((row): row is ScheduleRowInput => row !== null);
  if (rows.length !== raw.length) {
    return { ok: false, errors: { [SCHEDULE_FIELD]: { code: 'contract_schedule_invalid' } } };
  }
  return { ok: true, rows };
}
