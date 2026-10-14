// The label-free rule over a whole-number box. Pure and client-safe.
import type { FieldError } from '@/lib/actions/field-errors';

/** Not a whole number from `min` to `max` (a blank box reads as 0 and is refused too). */
export function wholeNumberInRange(value: number, min: number, max: number): FieldError | null {
  return Number.isInteger(value) && value >= min && value <= max
    ? null
    : { code: 'out_of_range', params: { min, max } };
}
