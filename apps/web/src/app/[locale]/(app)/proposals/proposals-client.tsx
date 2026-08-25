'use client';

import { FileText, Plus, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Link, useRouter } from '@/i18n/routing';
import { formatMoney } from '@/lib/format/money';
import {
  formatProposalNumber,
  proposalYear,
} from '@/lib/format/proposal-number';
import { pickLocale } from '@/lib/i18n/pick-locale';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-[color:var(--brand-tint)] text-[color:var(--brand-ink)]',
  accepted: 'bg-[color:var(--success-tint)] text-[color:var(--success)]',
  rejected: 'bg-destructive/10 text-destructive',
  expired: 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]',
  superseded: 'bg-muted text-muted-foreground',
};

export interface ProposalsClientProps {
  items: ProposalListRow[];
  canManage: boolean;
  hasClients: boolean;
}

export function ProposalsClient({
  items,
  canManage,
  hasClients,
}: ProposalsClientProps) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const router = useRouter();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((p) =>
      `${p.number} ${p.titleEn ?? ''} ${p.titleAr ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, q]);

  const num = (p: ProposalListRow) =>
    formatProposalNumber(p.number, proposalYear(p.issueDate, p.createdAt));

  const newButton = canManage && hasClients && (
    <Button data-tour="proposals-new" onClick={() => router.push('/proposals/new')}>
      <Plus className="size-4" aria-hidden />
      {t('actions.new')}
    </Button>
  );

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <EmptyState
            icon={<FileText className="size-6" aria-hidden />}
            title={t('empty.title')}
            description={t('empty.description')}
            hint={!hasClients ? t('empty.needProject') : undefined}
            action={newButton || undefined}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            className="ps-9"
          />
        </div>
        {newButton && <div className="ms-auto">{newButton}</div>}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t('table.number')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.title')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.client')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.status')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('table.total')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const title = pickLocale(
                    { nameAr: p.titleAr, nameEn: p.titleEn },
                    'name',
                    locale,
                  ).value;
                  const clientName = pickLocale(
                    { nameAr: p.clientNameAr, nameEn: p.clientNameEn },
                    'name',
                    locale,
                  ).value;
                  const href =
                    p.status === 'draft'
                      ? `/proposals/${p.id}`
                      : `/proposals/${p.id}/view`;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                        <Link href={href} className="text-primary hover:underline">
                          {num(p)}
                        </Link>
                      </td>
                      <td className="px-4 py-2">{title}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {clientName || '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] ?? 'bg-muted'}`}
                        >
                          {t(`statuses.${p.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end" dir="ltr">
                        {formatMoney(p.total, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
