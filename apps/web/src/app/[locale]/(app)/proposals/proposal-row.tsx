'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import { formatProposalNumber, proposalYear } from '@/lib/format/proposal-number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { ProposalKindTag } from './proposal-kind-tag';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-[color:var(--brand-tint)] text-[color:var(--brand-ink)]',
  accepted: 'bg-[color:var(--success-tint)] text-[color:var(--success)]',
  rejected: 'bg-destructive/10 text-destructive',
  expired: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  superseded: 'bg-muted text-muted-foreground',
};

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
        <span
          className={`rounded-pill px-2 py-0.5 text-caption ${STATUS_STYLE[row.status] ?? 'bg-muted'}`}
        >
          {t(`statuses.${row.status}`)}
        </span>
      </td>
      <td className="px-4 py-2 text-end" dir="ltr">
        {formatMoney(row.total, locale)}
      </td>
    </tr>
  );
}
