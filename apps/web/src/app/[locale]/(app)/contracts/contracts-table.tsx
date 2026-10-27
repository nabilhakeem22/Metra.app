'use client';

import type { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { StatusChip } from '@/components/ui/status-chip';
import { Link } from '@/i18n/routing';
import type { ContractListRow } from '@/lib/contracts/queries';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { CONTRACT_STATUS_TONE } from '@/lib/ui/record-status-tones';

// A cell with no client or project name shows a dash (an em dash, written as an
// escape so the source carries none).
const EMPTY_CELL = '—';

/** The contracts register: number (a link), client, project, status and original value. */
export function ContractsTable({
  items,
  locale,
  t,
}: {
  items: ContractListRow[];
  locale: string;
  t: ReturnType<typeof useTranslations<'contracts'>>;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b text-caption text-muted-foreground">
                <th className="px-4 py-2 text-start font-medium">{t('number')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('client')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('project')}</th>
                <th className="px-4 py-2 text-start font-medium">{t('status.draft')}</th>
                <th className="px-4 py-2 text-end font-medium">{t('value')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2 font-mono text-caption" dir="ltr">
                    <Link href={`/contracts/${c.id}`} className="text-primary hover:underline">
                      {formatDocNumber('C', c.number, docYear(null, c.createdAt))}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {pickLocale({ nameAr: c.clientNameAr, nameEn: c.clientNameEn }, 'name', locale).value || EMPTY_CELL}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {pickLocale({ nameAr: c.projectNameAr, nameEn: c.projectNameEn }, 'name', locale).value || EMPTY_CELL}
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip
                      tone={CONTRACT_STATUS_TONE[c.status]}
                      label={t(`status.${c.status}`)}
                    />
                  </td>
                  <td className="px-4 py-2 text-end" dir="ltr">
                    {formatMoney(c.originalValue, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
