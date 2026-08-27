'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
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

// Enum values declared locally (typed by the type-only @metra/db import) — a
// client component must never import a runtime @metra/db value.
const MILESTONE_KINDS: MilestoneKind[] = ['deposit', 'gate_a', 'gate_b', 'balance'];
const MILESTONE_BASES: MilestoneBasis[] = ['percent', 'amount'];

interface Row {
  kind: MilestoneKind;
  value: string;
}

export function EngagementFeeForm({
  engagementId,
  pending,
  onSubmit,
  onCancel,
}: {
  engagementId: string;
  pending: boolean;
  onSubmit: (fn: () => Promise<ActionResult>) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('engagements.feeForm');
  const tc = useTranslations('engagements.controls');
  const tk = useTranslations('engagements.milestoneKind');
  const tb = useTranslations('engagements.milestoneBasis');
  const [designFee, setDesignFee] = useState('');
  const [basis, setBasis] = useState<MilestoneBasis>('percent');
  const [rows, setRows] = useState<Row[]>(
    MILESTONE_KINDS.map((kind) => ({ kind, value: '' })),
  );

  function setRow(index: number, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, value } : r)));
  }

  function submit() {
    const milestones = rows
      .filter((r) => r.value.trim() !== '')
      .map((r) => ({ kind: r.kind, basis, value: r.value.trim() }));
    onSubmit(() => submitDesignFee(engagementId, { designFee: designFee.trim(), milestones }));
  }

  return (
    // Flat tray (opaque --track fill, no .glass) so opening the fee form inside
    // the glass "next actions" Card never nests backdrop-filter.
    <div className="space-y-4 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <p className="text-sm font-medium">{t('title')}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fee-amount">{t('designFee')}</Label>
          <Input
            id="fee-amount"
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            value={designFee}
            onChange={(e) => setDesignFee(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fee-basis">{t('basis')}</Label>
          <Select
            value={basis}
            onValueChange={(v) => setBasis(v as MilestoneBasis)}
          >
            <SelectTrigger id="fee-basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MILESTONE_BASES.map((b) => (
                <SelectItem key={b} value={b}>
                  {tb(b)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t('milestones')}</p>
        {rows.map((row, index) => (
          <div key={row.kind} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-sm">{tk(row.kind)}</span>
            <Input
              dir="ltr"
              inputMode="decimal"
              className="tabular-nums"
              aria-label={`${tk(row.kind)} ${t('value')}`}
              value={row.value}
              onChange={(e) => setRow(index, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {tc('cancel')}
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('submit')}
        </Button>
      </div>
    </div>
  );
}
