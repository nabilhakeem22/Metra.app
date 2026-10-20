'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import type { ActionResult } from '@/lib/actions/result';
import { createVariationDraft, saveVariationDraft } from '@/lib/variations/actions';
import { keyedLineErrors, variationLinePath, type VariationLineColumn } from '@/lib/variations/line-fields';
import { TIME_EXTENSION_FIELD, timeExtensionFieldErrors } from '@/lib/variations/time-extension';
import type { DraftVoLine } from './contract-vo-types';

// The "new variation order" flow: its typed state, and the two writes it makes
// (open the draft, then save its lines). Every refusal is said under the box or
// line cell it is about; Save is never disabled for an empty title, pressing it
// says what is missing.

/** The line cells the form renders; a refusal of any other cell is said above Save. */
export const VO_LINE_COLUMNS = [
  'contractLineId',
  'description',
  'qty',
  'unit',
  'unitPrice',
] as const satisfies readonly VariationLineColumn[];

export type VoLineColumn = (typeof VO_LINE_COLUMNS)[number];

const NEW_LINE: Omit<DraftVoLine, 'key'> = {
  contractLineId: '',
  contractLineLabel: '',
  descriptionEn: '',
  qty: '1',
  unit: 'lump_sum',
  unitPrice: '0',
  discountPct: '0',
};

function renderedFields(lines: readonly DraftVoLine[], withDays: boolean): string[] {
  const header = withDays ? ['title', 'reason', TIME_EXTENSION_FIELD] : ['title', 'reason'];
  return [...header, ...lines.flatMap((line) => VO_LINE_COLUMNS.map((column) => variationLinePath(line.key, column)))];
}

/** The answer with its line refusals on the keys of the rows that were sent. */
function onSentRows(result: ActionResult, sent: readonly DraftVoLine[]): ActionResult {
  if (!result.fields) return result;
  return { ...result, fields: keyedLineErrors(result.fields, sent.map((line) => line.key)) };
}

/**
 * `withDays`: an execution contract's order may add days to the finish date;
 * a proposal contract's form has no such box and never sends one.
 */
export function useVariationCreate(contractId: string, withDays: boolean) {
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [lines, setLines] = useState<DraftVoLine[]>([]);
  const [pending, startTransition] = useTransition();
  // The draft this form already opened. When its lines are refused, the retry
  // saves THAT draft again rather than opening a second variation order.
  const createdId = useRef<string | null>(null);
  const nextKey = useRef(0);
  const errors = useFieldErrors({ fields: renderedFields(lines, withDays), translate: te });

  function reset() {
    setTitle('');
    setReason('');
    setDays('');
    setLines([]);
    createdId.current = null;
    errors.clear();
  }

  function toggle() {
    if (open) reset();
    setOpen(!open);
  }

  function updateLine(index: number, patch: Partial<DraftVoLine>) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    const removed = lines[index];
    // The other rows keep their refusals: they are held by row key.
    if (removed) for (const column of VO_LINE_COLUMNS) errors.bind(variationLinePath(removed.key, column)).onEdit();
    setLines((current) => current.filter((_, at) => at !== index));
  }

  async function send(): Promise<ActionResult> {
    const header = { titleEn: title, reasonEn: reason || null, timeExtensionDays: withDays ? days : undefined };
    let id = createdId.current;
    if (!id) {
      const created = await createVariationDraft({ contractId, ...header });
      if (!created.ok || !created.data) return created;
      id = createdId.current = created.data;
      if (lines.length === 0) return created;
    }
    return saveVariationDraft({
      id,
      header,
      lines: lines.map((line, index) => ({
        contractLineId: line.contractLineId || null,
        descriptionEn: line.descriptionEn,
        qty: line.qty,
        unit: line.unit,
        unitPrice: line.unitPrice,
        discountPct: line.discountPct,
        sortOrder: index,
      })),
    });
  }

  function save() {
    const refusals = {
      ...(title.trim() ? {} : { title: { code: 'name_required' as const } }),
      ...(withDays ? timeExtensionFieldErrors(days) : {}),
    };
    if (errors.applyLocal(refusals)) return;
    startTransition(async () => {
      try {
        const sent = lines;
        if (errors.applyResult(onSentRows(await send(), sent))) return;
      } catch (rejection) {
        errors.applyRejection(rejection);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return {
    withDays,
    open,
    toggle,
    title,
    setTitle,
    reason,
    setReason,
    days,
    setDays,
    lines,
    addLine: () => setLines((current) => [...current, { ...NEW_LINE, key: `vo-${(nextKey.current += 1)}` }]),
    updateLine,
    removeLine,
    save,
    pending,
    errors,
  };
}

export type VariationCreateApi = ReturnType<typeof useVariationCreate>;
