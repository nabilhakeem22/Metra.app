'use client';

import { FileText, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ProposalListRow } from '@/lib/proposals/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { ProposalRow } from './proposal-row';

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
  const router = useRouter();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    // A BOQ working copy's Q- number is never shown, so it is not searchable.
    return items.filter((p) =>
      `${p.kind === 'quote' ? p.number : ''} ${p.titleEn ?? ''} ${p.titleAr ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [items, q]);

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
                {filtered.map((p) => (
                  <ProposalRow key={p.id} row={p} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
