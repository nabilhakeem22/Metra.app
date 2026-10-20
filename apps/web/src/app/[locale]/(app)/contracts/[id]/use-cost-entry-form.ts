'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { todayInCairo } from '@/lib/automation/clock';
import { createCostEntry, updateCostEntry } from '@/lib/execution/costs/actions';
import { COST_ENTRY_FIELDS, costEntryFieldErrors } from '@/lib/execution/costs/input';
import type { CostEntryRow } from '@/lib/execution/costs/types';
import { costEntryFormOf, costEntryPayload, emptyCostEntryForm, type CostEntryFormState } from './cost-entry-form-state';
import { costItemLabel, lineLabel } from './cost-entry-labels';

/**
 * The cost entry sheet: record a new cost or edit a listed one. Save checks
 * the typed values first and says what is wrong under each box; what only the
 * server knows (a line no longer in the section, an entry voided meanwhile)
 * comes back the same way, or above the footer. A new entry carries one
 * idempotency key from opening to success, so a Save retried after a lost
 * answer records it once. `onSaved` runs after every saved entry.
 */
export function useCostEntryForm(contractId: string, onSaved: () => void) {
  const t = useTranslations('contracts.costs');
  const te = useTranslations('errors');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CostEntryRow | null>(null);
  const [form, setForm] = useState<CostEntryFormState>(() => emptyCostEntryForm(todayInCairo(new Date())));
  const [pending, startTransition] = useTransition();
  const key = useRef<string>('');
  const errors = useFieldErrors({ fields: COST_ENTRY_FIELDS, translate: te });

  function openNew() {
    errors.clear();
    key.current = crypto.randomUUID();
    setEditing(null);
    setForm(emptyCostEntryForm(todayInCairo(new Date())));
    setOpen(true);
  }

  function openEdit(entry: CostEntryRow) {
    errors.clear();
    setEditing(entry);
    setForm(costEntryFormOf(entry, { line: lineLabel(entry, locale), costItem: costItemLabel(entry, locale) }));
    setOpen(true);
  }

  function update(patch: Partial<CostEntryFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function submit() {
    const payload = costEntryPayload(form);
    if (errors.applyLocal(costEntryFieldErrors(payload, todayInCairo(new Date())))) return;
    startTransition(async () => {
      try {
        const result = editing
          ? await updateCostEntry({ id: editing.id, ...payload })
          : await createCostEntry({ contractId, idempotencyKey: key.current, ...payload });
        if (errors.applyResult(result)) return;
        toast({ title: t(editing ? 'toast.updated' : result.already ? 'toast.already' : 'toast.recorded') });
        setOpen(false);
        onSaved();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { open, setOpen, editing, form, update, openNew, openEdit, submit, pending, errors };
}

export type CostEntryFormApi = ReturnType<typeof useCostEntryForm>;
