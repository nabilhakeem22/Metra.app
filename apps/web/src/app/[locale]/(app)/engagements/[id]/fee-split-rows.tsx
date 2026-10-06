'use client';

import { useTranslations } from 'next-intl';
import type { MilestoneKind } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_MILESTONE_KINDS, OPTIONAL_MILESTONE_KINDS } from '@/lib/engagements/default-fee-split';

export interface FeeSplitRow {
  kind: MilestoneKind;
  value: string;
}

/** The fee form's milestone rows and the "add a payment" buttons. PRESENTATIONAL. */
export function FeeSplitRows({
  rows,
  onChange,
  onAdd,
  onRemove,
}: {
  rows: FeeSplitRow[];
  onChange: (index: number, value: string) => void;
  onAdd: (kind: MilestoneKind) => void;
  onRemove: (kind: MilestoneKind) => void;
}) {
  const t = useTranslations('engagements.feeForm');
  const tk = useTranslations('engagements.milestoneKind');
  // Only milestones NOT already on the schedule can be added.
  const addable = OPTIONAL_MILESTONE_KINDS.filter((kind) => !rows.some((row) => row.kind === kind));

  return (
    <div className="space-y-2">
      <p className="text-caption font-medium text-muted-foreground">{t('milestones')}</p>
      {rows.map((row, index) => (
        <div key={row.kind} className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-body">{tk(row.kind)}</span>
          <Input
            dir="ltr"
            inputMode="decimal"
            className="tabular-nums"
            aria-label={`${tk(row.kind)} ${t('value')}`}
            value={row.value}
            onChange={(event) => onChange(index, event.target.value)}
          />
          {/* Only an ADDED milestone can be removed — the three defaults are the
              schedule the product recommends, and dropping one silently would
              turn its gate free without the studio meaning it. */}
          {!DEFAULT_MILESTONE_KINDS.includes(row.kind) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(row.kind)}>
              {t('remove')}
            </Button>
          )}
        </div>
      ))}
      {addable.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {addable.map((kind) => (
            <Button key={kind} type="button" variant="outline" size="sm" onClick={() => onAdd(kind)}>
              {t('addNamed', { name: tk(kind) })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
