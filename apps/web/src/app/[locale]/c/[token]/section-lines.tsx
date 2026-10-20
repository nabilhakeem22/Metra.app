'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import type { PublicContractLine, PublicContractSection } from '@/lib/contracts/public-types';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { loadContractSectionLines } from './actions';

/** What a "show more" left on screen: a shared portal failure, or this page's own sentence. */
type LoadProblem = { failure: ShownPortalFailure } | { own: 'gone' | 'loadFailed' };

/**
 * One section of the contract: its subtotal, its opening lines (none when the
 * page's opening window ended before it), and "show lines" for the rest, 100
 * at a time through the link's read budget.
 */
export function SectionLines({ token, section }: { token: string; section: PublicContractSection }) {
  const t = useTranslations('contracts.ack.lines');
  const locale = useLocale();
  const [lines, setLines] = useState<PublicContractLine[]>(section.lines);
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [pending, startTransition] = useTransition();
  const remaining = section.line_count - lines.length;
  const text = (ar: string | null, en: string | null) => pickLocale({ textAr: ar, textEn: en }, 'text', locale).value;

  function showMore() {
    setProblem(null);
    startTransition(async () => {
      try {
        const answer = await loadContractSectionLines(token, section.id, lines.length);
        if (answer.ok) setLines((shown) => [...shown, ...answer.page.lines]);
        else if (answer.error === 'gone') setProblem({ own: 'gone' });
        else setProblem({ failure: answer });
      } catch {
        setProblem({ own: 'loadFailed' });
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h2 className="text-body font-semibold">{text(section.title_ar, section.title_en)}</h2>
          <span className="font-mono tabular-nums text-body" dir="ltr">{formatMoney(section.section_subtotal, locale)}</span>
        </div>
        {lines.length > 0 && (
          <table className="w-full text-body">
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    {line.item_code && <span className="me-2 text-muted-foreground" dir="ltr">{line.item_code}</span>}
                    {text(line.description_ar, line.description_en)}
                    {line.provisional && <span className="ms-2 text-caption text-muted-foreground">{t('provisional')}</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                    {formatQuantity(line.qty, locale)} {line.unit}
                  </td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{formatMoney(line.unit_price, locale)}</td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{formatMoney(line.line_total, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {remaining > 0 && (
          <div className="space-y-2 border-t px-4 py-3 text-center">
            <Button variant="secondary" size="sm" onClick={showMore} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {lines.length === 0 ? t('show', { count: remaining }) : t('showMore', { count: remaining })}
            </Button>
            {problem && 'failure' in problem && <PortalFailureAlert failure={problem.failure} />}
            {problem && 'own' in problem && (
              <p role="alert" className="text-body text-destructive">{t(problem.own)}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
