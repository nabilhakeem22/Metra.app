'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ContractDetail } from '@/lib/contracts/queries';
import { ContractHeaderForm } from './contract-header-form';

export function ContractOverview({
  detail,
  canManage,
  canIssue,
  pending,
  m,
  onIssue,
  onTerminate,
}: {
  detail: ContractDetail;
  canManage: boolean;
  canIssue: boolean;
  pending: boolean;
  m: (v: string) => string;
  onIssue: () => void;
  onTerminate: () => void;
}) {
  const t = useTranslations('contracts');
  const locale = useLocale();
  const pick = (ar: string | null, en: string | null) =>
    pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;
  const revised = detail.revisedValue !== detail.originalValue;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs`}>
            {t(`status.${detail.status}`)}
          </span>
          <span className="text-muted-foreground">
            {t('originalValue')}: <span dir="ltr">{m(detail.originalValue)}</span>
          </span>
          {revised && (
            <span className="text-muted-foreground">
              {t('revisedValue')}: <span dir="ltr">{m(detail.revisedValue)}</span>
            </span>
          )}
          <div className="ms-auto flex gap-2">
            {canIssue && detail.status === 'draft' && (
              <Button size="sm" disabled={pending} onClick={onIssue}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t('issue')}
              </Button>
            )}
            {canIssue &&
              (detail.status === 'issued' || detail.status === 'signed') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={onTerminate}
                >
                  {t('terminate')}
                </Button>
              )}
          </div>
        </CardContent>
      </Card>

      {canManage && detail.status === 'draft' && (
        <ContractHeaderForm detail={detail} />
      )}

      {detail.sections.map((s) => (
        <Card key={s.id}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">{pick(s.titleAr, s.titleEn)}</h2>
              <span className="text-sm" dir="ltr">
                {m(s.sectionSubtotal)}
              </span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(l.descriptionAr, l.descriptionEn)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {l.qty} {l.unit}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(l.unitPrice)}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(l.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
