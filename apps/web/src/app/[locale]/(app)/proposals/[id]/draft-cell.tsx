import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import type { DraftCellError } from './use-draft-field-errors';

/** The attributes that mark a builder cell refused and point it at its sentence. */
export function cellA11y(id: string, error: DraftCellError) {
  return {
    'aria-invalid': error.message ? true : undefined,
    'aria-describedby': error.message ? fieldErrorId(id) : undefined,
  } as const;
}

/** A builder cell's refusal, said under the cell. */
export function CellError({ id, error }: { id: string; error: DraftCellError }) {
  return <FieldErrorText id={fieldErrorId(id)} message={error.message} />;
}
