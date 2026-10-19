'use client';

import type { MilestoneBasis } from '@metra/db';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { saveContractSchedule } from '@/lib/contracts/actions';
import type { ContractScheduleView } from '@/lib/contracts/schedule/queries';
import { SCHEDULE_FIELD, scheduleLabelPath, scheduleValuePath } from '@/lib/contracts/schedule/input';
import { MAX_SCHEDULE_ROWS, validateSchedule } from '@/lib/execution/money/schedule';
import { readMoney } from '@/lib/money/read';

export interface ScheduleFormRow {
  key: string;
  labelAr: string;
  labelEn: string;
  value: string;
}

let rowSeq = 0;
const newKey = () => `schedule-row-${String(++rowSeq)}`;

/** The opening rows: the saved schedule, or 50 / 30 / 20 named in the studio's language. */
function openingRows(saved: ContractScheduleView, defaults: string[], arabic: boolean): ScheduleFormRow[] {
  if (saved.rows.length > 0) {
    return saved.rows.map((row) => ({
      key: newKey(),
      labelAr: row.labelAr ?? '',
      labelEn: row.labelEn ?? '',
      value: row.value.replace(/\.?0+$/, ''),
    }));
  }
  return ['50', '30', '20'].map((value, index) => ({
    key: newKey(),
    labelAr: arabic ? defaults[index] : '',
    labelEn: arabic ? '' : defaults[index],
    value,
  }));
}

/** Every box the form can refuse: the schedule as a whole, and each row's two. */
function scheduleFields(count: number): string[] {
  return [SCHEDULE_FIELD, ...Array.from({ length: count }, (_, index) => [scheduleLabelPath(index), scheduleValuePath(index)]).flat()];
}

/** The draft schedule's state, its live total, and its save. */
export function useScheduleForm(input: {
  contractId: string;
  saved: ContractScheduleView;
  contract: { originalValue: string; taxAmount: string };
}) {
  const t = useTranslations('contracts.execution.schedule');
  const te = useTranslations('errors');
  const arabic = useLocale().startsWith('ar');
  const router = useRouter();
  const [basis, setBasis] = useState<MilestoneBasis>(input.saved.rows[0]?.basis ?? 'percent');
  const [rows, setRows] = useState(() =>
    openingRows(input.saved, [t('defaults.advance'), t('defaults.works'), t('defaults.handover')], arabic),
  );
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: scheduleFields(rows.length), translate: te });

  const total = formatMoney4(
    rows.reduce((sum, row) => {
      const read = readMoney(row.value);
      return read.ok ? sum + parseMoney4(read.value) : sum;
    }, 0n),
  );
  const toSend = () =>
    rows.map((row) => ({ labelAr: row.labelAr, labelEn: row.labelEn, basis, value: row.value }));

  function edit(index: number, patch: Partial<ScheduleFormRow>) {
    setSaved(false);
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  }

  function save() {
    const local = validateSchedule(toSend(), input.contract.originalValue, input.contract.taxAmount);
    if (errors.applyLocal(local.ok ? {} : local.errors)) return;
    startTransition(async () => {
      try {
        const res = await saveContractSchedule({ contractId: input.contractId, milestones: toSend() });
        if (errors.applyResult(res)) return;
        setSaved(true);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return {
    basis,
    rows,
    total,
    saved,
    pending,
    errors,
    canAdd: rows.length < MAX_SCHEDULE_ROWS,
    setBasis(next: MilestoneBasis) {
      errors.clear();
      setSaved(false);
      setBasis(next);
    },
    edit,
    add: () => setRows((current) => [...current, { key: newKey(), labelAr: '', labelEn: '', value: '' }]),
    // Errors are kept by row position, so a removal clears them rather than leave one on the wrong row.
    remove(index: number) {
      errors.clear();
      setRows((current) => current.filter((_, at) => at !== index));
    },
    save,
  };
}
