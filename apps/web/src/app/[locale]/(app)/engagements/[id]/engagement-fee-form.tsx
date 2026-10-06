'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { MilestoneBasis, MilestoneKind } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionResult } from '@/lib/actions/result';
import { submitDesignFee } from '@/lib/engagements/actions';
import {
  DEFAULT_MILESTONE_KINDS,
  byDueOrder,
  type FeeSplitPrefill,
} from '@/lib/engagements/default-fee-split';
import { summarizeFeeSplit } from '@/lib/engagements/fee-split-total';
import { formatMoney } from '@/lib/format/money';
import { FeeSplitRows, type FeeSplitRow } from './fee-split-rows';

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const MILESTONE_BASES: MilestoneBasis[] = ['percent', 'amount'];

/** "100.0000" -> "100": the percent total as a person reads it (Latin digits). */
function plainPercent(scale4: string): string {
  return scale4.replace(/\.?0+$/, '');
}

/**
 * The design fee and its payment split. Opens on the studio's LAST split (in
 * percent) or 50/30/20, shows a live total, and keeps Submit disabled until the
 * split is one the server accepts: a fee, a deposit, and 100% (or the fee, on
 * the amount basis).
 */
export function EngagementFeeForm({
  engagementId,
  prefill,
  pending,
  onSubmit,
  onCancel,
}: {
  engagementId: string;
  /** The opening split; null opens the three default rows empty. */
  prefill: FeeSplitPrefill | null;
  pending: boolean;
  onSubmit: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.feeForm');
  const tc = useTranslations('engagements.controls');
  const tb = useTranslations('engagements.milestoneBasis');
  const locale = useLocale();
  const [designFee, setDesignFee] = useState('');
  const [basis, setBasis] = useState<MilestoneBasis>('percent');
  const [rows, setRows] = useState<FeeSplitRow[]>(
    () => prefill?.rows ?? DEFAULT_MILESTONE_KINDS.map((kind) => ({ kind, value: '' })),
  );
  const summary = summarizeFeeSplit({ basis, designFee, rows });

  const setRow = (index: number, value: string) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, value } : row)));
  /** Add one optional milestone, kept in due order rather than click order. */
  const addRow = (kind: MilestoneKind) =>
    setRows((prev) => [...prev, { kind, value: '' }].sort((a, b) => byDueOrder(a.kind, b.kind)));
  const removeRow = (kind: MilestoneKind) =>
    setRows((prev) => prev.filter((row) => row.kind !== kind));

  function submit() {
    const milestones = rows
      .filter((row) => row.value.trim() !== '')
      .map((row) => ({ kind: row.kind, basis, value: row.value.trim() }));
    onSubmit(() => submitDesignFee(engagementId, { designFee: designFee.trim(), milestones }));
  }

  return (
    // Flat tray (opaque --track fill, no .glass) so opening the fee form inside
    // the glass "next actions" Card never nests backdrop-filter.
    <div className="space-y-4 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <p className="text-body font-medium">{t('title')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fee-amount">{t('designFee')}</Label>
          <Input
            id="fee-amount"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={designFee}
            onChange={(event) => setDesignFee(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fee-basis">{t('basis')}</Label>
          <Select value={basis} onValueChange={(value) => setBasis(value as MilestoneBasis)}>
            <SelectTrigger id="fee-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MILESTONE_BASES.map((option) => (
                <SelectItem key={option} value={option}>
                  {tb(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {prefill?.source === 'lastUsed' && (
        <p className="text-caption text-muted-foreground">{t('prefilledFromLast')}</p>
      )}
      <FeeSplitRows rows={rows} onChange={setRow} onAdd={addRow} onRemove={removeRow} />

      <div className="space-y-1 text-body" aria-live="polite">
        {summary.target !== null && (
          <p className={`tabular-nums ${summary.balanced ? '' : 'text-[color:var(--warn)]'}`}>
            {basis === 'percent'
              ? t('totalPercent', { total: plainPercent(summary.total) })
              : t('totalAmount', {
                  total: formatMoney(summary.total, locale),
                  target: formatMoney(summary.target, locale),
                })}
          </p>
        )}
        {!summary.hasFee && <p className="text-caption text-muted-foreground">{t('needsFee')}</p>}
        {!summary.hasDeposit && <p className="text-caption text-muted-foreground">{t('needsDeposit')}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {tc('cancel')}
        </Button>
        <Button type="button" onClick={submit} disabled={pending || !summary.canSubmit}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </Button>
      </div>
    </div>
  );
}
