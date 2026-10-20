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
import { costItemLabel, lineLabel, sectionLabel } from './cost-entry-labels';

/**
 * The cost entry sheet: record a new cost or edit a listed one. Save checks
 * the typed values first and says what is wrong under each box; what only the
 * server knows (a line no longer in the section, an entry voided meanwhile)
 * comes back the same way, or above the footer. A new entry carries one
 * idempotency key from opening to success, so a Save retried after a lost
 * answer records it once; values changed after a Save that did not succeed
 * are a new entry, sent under a new key (R3: the old key answered "already
 * recorded" and kept the first values). `onSaved` runs after every saved entry.
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
  /** The values the current key was last sent with; null until a Save sends it. */
  const sentWithKey = useRef<string | null>(null);
  const errors = useFieldErrors({ fields: COST_ENTRY_FIELDS, translate: te });

  function openNew() {
    errors.clear();
    key.current = crypto.randomUUID();
    sentWithKey.current = null;
    setEditing(null);
    setForm(emptyCostEntryForm(todayInCairo(new Date())));
    setOpen(true);
  }

  function openEdit(entry: CostEntryRow) {
    errors.clear();
    setEditing(entry);
    setForm(costEntryFormOf(entry, { section: sectionLabel(entry, locale), line: lineLabel(entry, locale), costItem: costItemLabel(entry, locale) }));
    setOpen(true);
  }

  function update(patch: Partial<CostEntryFormState>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  /** The key a create is sent under: the same for the same values, a new one once they changed. */
  function idempotencyKeyFor(payload: ReturnType<typeof costEntryPayload>): string {
    const values = JSON.stringify(payload);
    if (sentWithKey.current !== null && sentWithKey.current !== values) key.current = crypto.randomUUID();
    sentWithKey.current = values;
    return key.current;
  }

  function submit() {
    const payload = costEntryPayload(form);
    if (errors.applyLocal(costEntryFieldErrors(payload, todayInCairo(new Date())))) return;
    startTransition(async () => {
      try {
        const result = editing
          ? await updateCostEntry({ id: editing.id, ...payload })
          : await createCostEntry({ contractId, idempotencyKey: idempotencyKeyFor(payload), ...payload });
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
