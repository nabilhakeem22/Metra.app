'use client';

import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMoney } from '@/lib/format/money';
import { FigureInput } from './figure-input';
import {
  INPUT_CLASS,
  UNITS,
  previewLine,
  type LineState,
} from './builder-model';

export function BuilderLineRow({
  line,
  sectionIndex,
  lineIndex,
  seeMargin,
  patchLine,
  removeLine,
}: {
  line: LineState;
  sectionIndex: number;
  lineIndex: number;
  seeMargin: boolean;
  patchLine: (si: number, li: number, patch: Partial<LineState>) => void;
  removeLine: (si: number, li: number) => void;
}) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const inp = INPUT_CLASS;
  const si = sectionIndex;
  const li = lineIndex;
  const lt = previewLine(line);

  return (
    <tr className="border-t" data-draft-line={`${si}-${li}`}>
      <td className="px-1 py-1">
        <Input dir="ltr" data-draft-input="description" value={line.descriptionEn} onChange={(e) => patchLine(si, li, { descriptionEn: e.target.value })} className={inp} />
      </td>
      <td className="px-1 py-1">
        <FigureInput data-draft-input="qty" value={line.qty} onValueChange={(v) => patchLine(si, li, { qty: v })} className={`${inp} w-16`} />
      </td>
      <td className="px-1 py-1">
        <Select value={line.unit} onValueChange={(v) => patchLine(si, li, { unit: v })}>
          <SelectTrigger className="h-9 w-auto min-w-16">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((u) => (
              <SelectItem key={u} value={u}>{u}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      {seeMargin && (
        <td className="px-1 py-1">
          <FigureInput data-draft-input="unitCost" value={line.unitCost} onValueChange={(v) => patchLine(si, li, { unitCost: v })} className={`${inp} w-20`} />
        </td>
      )}
      <td className="px-1 py-1">
        <FigureInput data-draft-input="unitPrice" value={line.unitPrice} onValueChange={(v) => patchLine(si, li, { unitPrice: v })} className={`${inp} w-20`} />
      </td>
      <td className="px-1 py-1">
        <FigureInput data-draft-input="discountPct" value={line.discountPct} onValueChange={(v) => patchLine(si, li, { discountPct: v })} className={`${inp} w-14`} />
      </td>
      <td className="px-1 py-1 text-end" dir="ltr">{formatMoney(lt.lineTotal, locale)}</td>
      <td className="px-1 py-1">
        <Button variant="ghost" size="icon" aria-label={t('builder.removeLine')} onClick={() => removeLine(si, li)}>
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </td>
    </tr>
  );
}
