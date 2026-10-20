'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { scheduleLabelPath, scheduleValuePath } from '@/lib/contracts/schedule/input';
import { normalizeDecimalInput } from '@/lib/validation/decimal-input';
import type { useScheduleForm } from './use-schedule-form';

/** The DOM ids of a row's boxes: its refusals sit under these. */
export const scheduleLabelControlId = (index: number) => `schedule-${String(index)}-label`;
export const scheduleLabelEnControlId = (index: number) => `schedule-${String(index)}-label-en`;
export const scheduleValueControlId = (index: number) => `schedule-${String(index)}-value`;

/**
 * The draft schedule's rows: each a label (Arabic, English; either is enough)
 * and a share or an amount. PRESENTATIONAL: the state and the save are
 * `useScheduleForm`. A label refusal sits under the Arabic box, the pair's
 * first.
 */
export function ScheduleRows({ form }: { form: ReturnType<typeof useScheduleForm> }) {
  const t = useTranslations('contracts.execution.schedule');
  const valueLabel = form.basis === 'percent' ? t('share') : t('amount');

  return (
    <div className="space-y-3">
      {form.rows.map((row, index) => (
        <div key={row.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
          <FormField id={scheduleLabelControlId(index)} label={t('labelAr')} {...form.errors.bind(scheduleLabelPath(index))}>
            <Input dir="rtl" value={row.labelAr} onChange={(event) => form.edit(index, { labelAr: event.target.value })} />
          </FormField>
          <FormField id={scheduleLabelEnControlId(index)} label={t('labelEn')} onEdit={form.errors.bind(scheduleLabelPath(index)).onEdit}>
            <Input dir="ltr" value={row.labelEn} onChange={(event) => form.edit(index, { labelEn: event.target.value })} />
          </FormField>
          <FormField id={scheduleValueControlId(index)} label={valueLabel} {...form.errors.bind(scheduleValuePath(index))}>
            <Input
              dir="ltr"
              inputMode="decimal"
              className="tabular-nums"
              value={row.value}
              onChange={(event) => form.edit(index, { value: event.target.value })}
              onBlur={(event) => form.edit(index, { value: normalizeDecimalInput(event.target.value) })}
            />
          </FormField>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={form.rows.length === 1}
            onClick={() => form.remove(index)}
          >
            {t('remove')}
          </Button>
        </div>
      ))}
      {form.canAdd && (
        <Button type="button" variant="secondary" size="sm" onClick={form.add}>
          {t('add')}
        </Button>
      )}
    </div>
  );
}
