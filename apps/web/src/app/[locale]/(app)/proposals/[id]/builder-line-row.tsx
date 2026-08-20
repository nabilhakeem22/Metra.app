'use client';

import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format/money';
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
    <tr className="border-t">
      <td className="px-1 py-1">
        <Input dir="ltr" value={line.descriptionEn} onChange={(e) => patchLine(si, li, { descriptionEn: e.target.value })} className={inp} />
      </td>
      <td className="px-1 py-1">
        <Input dir="ltr" inputMode="decimal" value={line.qty} onChange={(e) => patchLine(si, li, { qty: e.target.value })} className={`${inp} w-16`} />
      </td>
      <td className="px-1 py-1">
        <select value={line.unit} onChange={(e) => patchLine(si, li, { unit: e.target.value })} className={inp}>
          {UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </td>
      {seeMargin && (
        <td className="px-1 py-1">
          <Input dir="ltr" inputMode="decimal" value={line.unitCost} onChange={(e) => patchLine(si, li, { unitCost: e.target.value })} className={`${inp} w-20`} />
        </td>
      )}
      <td className="px-1 py-1">
        <Input dir="ltr" inputMode="decimal" value={line.unitPrice} onChange={(e) => patchLine(si, li, { unitPrice: e.target.value })} className={`${inp} w-20`} />
      </td>
      <td className="px-1 py-1">
        <Input dir="ltr" inputMode="decimal" value={line.discountPct} onChange={(e) => patchLine(si, li, { discountPct: e.target.value })} className={`${inp} w-14`} />
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
