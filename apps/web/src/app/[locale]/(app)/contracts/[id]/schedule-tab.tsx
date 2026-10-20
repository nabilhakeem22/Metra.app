'use client';

import type { ContractStatus, MilestoneBasis } from '@metra/db';
import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { SCHEDULE_FIELD } from '@/lib/contracts/schedule/input';
import type { ContractScheduleView } from '@/lib/contracts/schedule/queries';
import { formatMoneyExact } from '@/lib/format/money';
import { formatPercent } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { ScheduleRows } from './schedule-rows';
import { useScheduleForm } from './use-schedule-form';

// Enum values declared locally (typed by the type-only import): a client
// component never imports a runtime @metra/db value.
const BASES: MilestoneBasis[] = ['percent', 'amount'];

export const SCHEDULE_BASIS_ID = 'schedule-basis';
export const SCHEDULE_TOTAL_ID = 'schedule-total';

interface ScheduleTabProps {
  contractId: string;
  status: ContractStatus;
  canManage: boolean;
  schedule: ContractScheduleView;
  contract: { originalValue: string; taxAmount: string };
  m: (value: string) => string;
}

/** The draft schedule's editor: one basis, 1 to 12 rows, a live total that the sum refusal sits under. */
function ScheduleEditor({ contractId, schedule, contract }: ScheduleTabProps) {
  const t = useTranslations('contracts.execution.schedule');
  const tc = useTranslations('contracts');
  const form = useScheduleForm({ contractId, saved: schedule, contract });
  const locale = useLocale();
  // The exact figure the validator enforces, to the 4th decimal: a rounded
  // target would ask for 1,600.75 and refuse it for not being 1,600.7453.
  const target = form.basis === 'percent' ? '100' : formatMoneyExact(contract.originalValue, locale);
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, form.errors.invalidAttempt);

  return (
    <div ref={formRef} className="space-y-4">
      <FormField id={SCHEDULE_BASIS_ID} label={t('basis')}>
        <SelectControl
          value={form.basis}
          onValueChange={(value) => form.setBasis(value as MilestoneBasis)}
          options={BASES.map((basis) => ({ value: basis, label: t(`bases.${basis}`) }))}
        />
      </FormField>
      <ScheduleRows form={form} />
      <FormField id={SCHEDULE_TOTAL_ID} label={t('total', { target })} {...form.errors.bind(SCHEDULE_FIELD)}>
        <Input readOnly dir="ltr" className="tabular-nums" value={form.total.replace(/\.?0+$/, '') || '0'} />
      </FormField>
      {form.errors.formError && (
        <p className="text-body text-destructive" role="alert">
          {form.errors.formError}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={form.pending} onClick={form.save}>
          {form.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('save')}
        </Button>
        {form.saved && <span className="text-body text-[color:var(--success)]">{tc('saved')}</span>}
      </div>
    </div>
  );
}

/** The signed (or still draft, for a role that cannot edit it) schedule, with what each row bills. */
function ScheduleTable({ schedule, m }: Pick<ScheduleTabProps, 'schedule' | 'm'>) {
  const t = useTranslations('contracts.execution.schedule');
  const locale = useLocale();
  if (schedule.rows.length === 0) return <p className="text-body text-muted-foreground">{t('empty')}</p>;
  return (
    <table className="w-full text-body">
      <tbody>
        {schedule.rows.map((row) => (
          <tr key={row.id} className="border-b last:border-0">
            <td className="py-2">{pickLocale({ labelAr: row.labelAr, labelEn: row.labelEn }, 'label', locale).value}</td>
            <td className="py-2 text-muted-foreground" dir="ltr">
              {row.basis === 'percent' ? formatPercent(row.value, locale) : null}
            </td>
            <td className="py-2 text-end font-mono tabular-nums" dir="ltr">{row.amount ? m(row.amount) : null}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The payment schedule the client signs (plan A6): edited while the contract is
 * a draft, frozen once it is sent. A saved schedule the charges no longer add
 * up to is said above it: sending is refused until it is saved again.
 */
export function ScheduleTab(props: ScheduleTabProps) {
  const t = useTranslations('contracts.execution.schedule');
  const editable = props.status === 'draft' && props.canManage;
  const stale = props.status === 'draft' && props.schedule.rows.length > 0 && !props.schedule.valid;
  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="space-y-1">
          <h2 className="text-body font-semibold">{t('title')}</h2>
          <p className="text-caption text-muted-foreground">{t('intro')}</p>
        </div>
        {stale && <p className="text-body text-destructive">{t('stale')}</p>}
        {editable ? <ScheduleEditor {...props} /> : <ScheduleTable schedule={props.schedule} m={props.m} />}
      </CardContent>
    </Card>
  );
}
