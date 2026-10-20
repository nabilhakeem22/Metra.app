'use client';

import { Loader2, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { TIME_EXTENSION_FIELD } from '@/lib/variations/time-extension';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import type { VariationCreateApi } from './use-variation-create';
import { VariationLineRow } from './variation-line-row';

export const VO_TITLE_ID = 'vo-title';
export const VO_REASON_ID = 'vo-reason';
export const VO_DAYS_ID = 'vo-days';

/**
 * The new-variation-order form. A missing title is said under it when Save is
 * pressed; a refused line cell under that cell; a refusal of the whole order
 * (a contract no longer issued, too many lines) above Save. An execution
 * contract's order also says how many days it adds to the finish date
 * (`create.withDays`), refused under that box.
 */
export function VariationCreateForm({
  create,
  contractId,
}: {
  create: VariationCreateApi;
  contractId: string;
}) {
  const tv = useTranslations('variations');
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, create.errors.invalidAttempt);

  return (
    <Card>
      <CardContent ref={formRef} className="space-y-3 py-4">
        <FormField id={VO_TITLE_ID} label={tv('title_')} required {...create.errors.bind('title')}>
          <Input value={create.title} onChange={(e) => create.setTitle(e.target.value)} />
        </FormField>
        <FormField id={VO_REASON_ID} label={tv('reason')} {...create.errors.bind('reason')}>
          <Input value={create.reason} onChange={(e) => create.setReason(e.target.value)} />
        </FormField>
        {create.withDays && (
          <FormField
            id={VO_DAYS_ID}
            label={tv('timeExtension.label')}
            hint={tv('timeExtension.hint')}
            {...create.errors.bind(TIME_EXTENSION_FIELD)}
          >
            <Input
              dir="ltr"
              inputMode="numeric"
              className="max-w-40 tabular-nums"
              value={create.days}
              onChange={(e) => create.setDays(e.target.value)}
              onBlur={(e) => create.setDays(normalizeDecimalInput(e.target.value))}
            />
          </FormField>
        )}
        <div className="space-y-2">
          {create.lines.map((line, index) => (
            <VariationLineRow
              key={line.key}
              index={index}
              line={line}
              contractId={contractId}
              create={create}
            />
          ))}
          <Button size="sm" variant="secondary" onClick={create.addLine}>
            <Plus className="size-4" aria-hidden />
            {tv('line.add')}
          </Button>
        </div>
        {create.errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {create.errors.formError}
          </p>
        )}
        <Button variant="default" size="sm" disabled={create.pending} onClick={create.save}>
          {create.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tv('saveDraft')}
        </Button>
      </CardContent>
    </Card>
  );
}
