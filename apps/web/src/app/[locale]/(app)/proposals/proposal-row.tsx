'use client';

import { useLocale, useTranslations } from 'next-intl';
import { StatusChip } from '@/components/ui/status-chip';
import { Link } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { PROPOSAL_STATUS_TONE } from '@/lib/ui/record-status-tones';
import { ProposalKindTag } from './proposal-kind-tag';

/** One register row. A BOQ working copy shows its tag, never its Q- number. */
export function ProposalRow({ row }: { row: ProposalListRow }) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const title = pickLocale({ nameAr: row.titleAr, nameEn: row.titleEn }, 'name', locale).value;
  const clientName = pickLocale(
    { nameAr: row.clientNameAr, nameEn: row.clientNameEn },
    'name',
    locale,
  ).value;
  const href = row.status === 'draft' ? `/proposals/${row.id}` : `/proposals/${row.id}/view`;

  return (
    <tr className="border-b last:border-0 hover:bg-muted/40">
      <td className="px-4 py-2 font-mono text-caption" dir="ltr">
        <Link href={href} className="text-primary hover:underline">
          {row.kind === 'boq' ? (
            <ProposalKindTag />
          ) : (
            formatProposalNumber(row.number, proposalYear(row.issueDate, row.createdAt))
          )}
        </Link>
      </td>
      <td className="px-4 py-2">{title}</td>
      <td className="px-4 py-2 text-muted-foreground">{clientName || '—'}</td>
      <td className="px-4 py-2">
        <StatusChip tone={PROPOSAL_STATUS_TONE[row.status]} label={t(`statuses.${row.status}`)} />
      </td>
      <td className="px-4 py-2 text-end" dir="ltr">
        {formatMoney(row.total, locale)}
      </td>
    </tr>
  );
}
