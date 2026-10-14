'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Input } from '@/components/ui/input';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { useSectionAdder } from './use-section-adder';

const NAME_ID = 'pb-new-section';

/**
 * The toolbar's "add a category" box. Add is never disabled for an empty box:
 * pressing it says, under the box, what is missing; a name another category has
 * is said there too, and anything else just below it.
 */
export function PriceBookSectionAdder() {
  const t = useTranslations('priceBook');
  const { name, setName, add, pending, errors } = useSectionAdder();
  const refusal = errors.messageFor('name');
  const adderRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(adderRef, errors.invalidAttempt);
  return (
    <div ref={adderRef} className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          id={NAME_ID}
          value={name}
          onChange={(e) => {
            errors.bind('name').onEdit();
            setName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder={t('addSectionPlaceholder')}
          className="h-10 w-40"
          aria-label={t('addSection')}
          aria-invalid={refusal ? true : undefined}
          aria-describedby={refusal ? fieldErrorId(NAME_ID) : undefined}
        />
        <Button variant="secondary" onClick={add} disabled={pending}>
          <Plus className="size-4" aria-hidden />
          {t('addSection')}
        </Button>
      </div>
      <FieldErrorText id={fieldErrorId(NAME_ID)} message={refusal} />
      {errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {errors.formError}
        </p>
      )}
    </div>
  );
}
