'use client';

import { useTranslations } from 'next-intl';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { BOQ_UNITS } from '@/lib/boqs/edit-input';
import { Td } from './boq-sheet-cells';
import { cellValueOf } from './boq-sheet-columns';
import { boqCellId, useCellRefusal } from './boq-sheet-editable-cell';
import type { BoqFieldProps } from './boq-sheet-row-fields';

const UNIT_SELECT =
  'w-full cursor-pointer rounded-item border border-transparent bg-transparent p-3 field-text text-[color:var(--text)] hover:bg-[color:var(--track)] outline-none focus-visible:border-[color:hsl(var(--brand))]';

export function BoqUnitCell({ line, api, typed, refused }: BoqFieldProps) {
  const t = useTranslations('projects.profile.boq');
  const refusal = useCellRefusal(refused, 'unit');
  const id = boqCellId(line.id, 'unit');
  // A unit is a CHOICE, so it saves on change rather than on blur: there is no
  // half-typed state to protect the document from.
  return (
    <Td>
      {api.canEdit ? (
        <>
          <select
            id={id}
            value={cellValueOf(line, 'unit', typed)}
            data-col="unit"
            aria-label={t('col.unit')}
            aria-invalid={refusal ? true : undefined}
            aria-describedby={refusal ? fieldErrorId(id) : undefined}
            onChange={(event) => {
              api.setCell(line.id, 'unit', event.target.value);
              api.saveLine(line, { unit: event.target.value }, ['unit']);
            }}
            className={UNIT_SELECT}
          >
            {BOQ_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t(`unit.${unit}`)}
              </option>
            ))}
          </select>
          <FieldErrorText id={fieldErrorId(id)} message={refusal} />
        </>
      ) : (
        <span className="block p-3 text-[color:var(--text-muted)]">
          {t(`unit.${line.unit}`)}
        </span>
      )}
    </Td>
  );
}
