'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ContractSectionSummary } from '@/lib/contracts/queries';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { useSectionLines } from './use-section-lines';

/**
 * One contract section: its title and subtotal, the lines shown so far, and
 * "show lines" while more remain (a page at a time, use-section-lines.ts). A
 * failed ask is said under the button that made it.
 */
export function ContractSectionCard({
  contractId,
  section,
  m,
}: {
  contractId: string;
  section: ContractSectionSummary;
  m: (v: string) => string;
}) {
  const t = useTranslations('contracts.lines');
  const locale = useLocale();
  const pick = (ar: string | null, en: string | null) =>
    pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;
  const shown = useSectionLines(contractId, section);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-body font-semibold">{pick(section.titleAr, section.titleEn)}</h2>
          <span className="text-body" dir="ltr">
            {m(section.sectionSubtotal)}
          </span>
        </div>
        {shown.lines.length > 0 && (
          <table className="w-full text-body">
            <tbody>
              {shown.lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{pick(line.descriptionAr, line.descriptionEn)}</td>
                  <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                    {line.qty} {line.unit}
                  </td>
                  <td className="px-4 py-2 text-end" dir="ltr">
                    {m(line.unitPrice)}
                  </td>
                  <td className="px-4 py-2 text-end" dir="ltr">
                    {m(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shown.hasMore && (
          <div className="space-y-2 border-t px-4 py-2">
            <Button size="sm" variant="secondary" disabled={shown.pending} onClick={shown.loadMore}>
              {shown.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t(shown.lines.length > 0 ? 'showMore' : 'show', {
                count: formatNumber(shown.remaining, locale),
              })}
            </Button>
            {shown.failure && (
              <p className="text-body text-destructive" role="alert">
                {shown.failure}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
