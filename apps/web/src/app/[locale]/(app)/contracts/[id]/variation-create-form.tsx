'use client';

import type { CostItemUnit } from '@metra/db';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Dispatch, SetStateAction } from 'react';
import { UNIT_TOKENS } from '@/lib/price-book/import';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BaselineLine, DraftVoLine } from './contract-vo-types';

// Radix Select forbids an empty-string item value, so the "net delta" choice
// (stored as '' on the line) rides a sentinel that is mapped back to '' at the
// state boundary — the persisted contractLineId stays byte-identical.
const NET_DELTA = '__net_delta__';

export function VariationCreateForm({
  title,
  onTitleChange,
  reason,
  onReasonChange,
  lines,
  setLines,
  baselineLines,
  onAddLine,
  onSave,
  saving,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  lines: DraftVoLine[];
  setLines: Dispatch<SetStateAction<DraftVoLine[]>>;
  baselineLines: BaselineLine[];
  onAddLine: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const tv = useTranslations('variations');

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <Input placeholder={tv('title_')} value={title} onChange={(e) => onTitleChange(e.target.value)} />
        <Input placeholder={tv('reason')} value={reason} onChange={(e) => onReasonChange(e.target.value)} />
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                value={l.contractLineId || NET_DELTA}
                onValueChange={(v) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, contractLineId: v === NET_DELTA ? '' : v } : x)))
                }
              >
                <SelectTrigger className="h-9 w-auto min-w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NET_DELTA}>{tv('netDelta')}</SelectItem>
                  {baselineLines.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-40"
                placeholder="description"
                value={l.descriptionEn}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, descriptionEn: e.target.value } : x)))
                }
              />
              <Input
                className="w-20"
                dir="ltr"
                value={l.qty}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                }
              />
              <Select
                value={l.unit}
                onValueChange={(v) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: v as CostItemUnit } : x)))
                }
              >
                <SelectTrigger className="h-9 w-auto min-w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_TOKENS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="w-24"
                dir="ltr"
                value={l.unitPrice}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))
                }
              />
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label="remove"
              >
                <Trash2 className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={onAddLine}>
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
        <Button size="sm" disabled={saving || !title.trim()} onClick={onSave}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {tv('saveDraft')}
        </Button>
      </CardContent>
    </Card>
  );
}
