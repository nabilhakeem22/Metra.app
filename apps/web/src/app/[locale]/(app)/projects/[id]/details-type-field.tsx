'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import type { DetailsOption } from './details-tab';
import type { useAddProjectType } from './use-add-project-type';

/** The add-a-type box; its refusal sits under it. */
export const NEW_TYPE_ID = 'p-new-type';

// Radix Select forbids an empty-string item value, so "no type" (persisted as
// '') rides a sentinel mapped back to '' when writing form state.
const NO_TYPE = '__no_type__';

// The project-type picker cell: a type Select plus the inline "add new type"
// control. The add box's state and its refusal live in useAddProjectType.
export function DetailsTypeField({
  typeId,
  onTypeIdChange,
  typeRefusal,
  projectTypes,
  label,
  canManage,
  addType,
}: {
  typeId: string;
  onTypeIdChange: (value: string) => void;
  /** A type deleted meanwhile, said under the picker. */
  typeRefusal: { error: string | undefined; onEdit: () => void };
  projectTypes: DetailsOption[];
  label: (o: DetailsOption) => string;
  canManage: boolean;
  addType: ReturnType<typeof useAddProjectType>;
}) {
  const t = useTranslations('projects');
  const tp = useTranslations('projects.profile.details');
  const th = useTranslations('hints.project');
  const addRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(addRef, addType.errors.invalidAttempt);

  return (
    <div className="space-y-2">
      <FormField id="p-type" label={tp('type')} hint={th('type')} {...typeRefusal}>
        <SelectControl
          value={typeId || NO_TYPE}
          onValueChange={(v) => onTypeIdChange(v === NO_TYPE ? '' : v)}
          options={[
            { value: NO_TYPE, label: t('profile.noType') },
            ...projectTypes.map((type) => ({ value: type.id, label: label(type) })),
          ]}
          disabled={!canManage}
        />
      </FormField>
      {canManage && (
        <div ref={addRef} className="space-y-1">
          <div className="flex items-center gap-1">
            <Input
              id={NEW_TYPE_ID}
              value={addType.name}
              onChange={(e) => {
                addType.clearOnEdit();
                addType.setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addType.add();
                }
              }}
              placeholder={tp('addTypePlaceholder')}
              aria-label={tp('addType')}
              aria-invalid={addType.error ? true : undefined}
              aria-describedby={addType.error ? fieldErrorId(NEW_TYPE_ID) : undefined}
              className="h-9"
            />
            <Button type="button" variant="secondary" size="sm" onClick={addType.add} disabled={addType.adding}>
              <Plus className="size-4" aria-hidden />
              {tp('addType')}
            </Button>
          </div>
          <FieldErrorText id={fieldErrorId(NEW_TYPE_ID)} message={addType.error} />
          {addType.errors.formError && (
            <p className="text-body text-destructive" role="alert">
              {addType.errors.formError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
