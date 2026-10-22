'use client';

import { FileText, Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { ProposalListRow } from '@/lib/proposals/queries';
import type { RegisterView } from '@/lib/registers/register-view';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { useRouter } from '@/i18n/routing';
import { ProposalRow } from './proposal-row';
import { useProposalSearch } from './use-proposal-search';

export interface ProposalsClientProps {
  /** One page of the proposals the search matches, searched on the server. */
  items: ProposalListRow[];
  /** Whether the studio has any proposal at all, whatever the search. */
  hasAnyProposal: boolean;
  /** The view the page was loaded with (?q=&page=), as the URL asks for it. */
  view: RegisterView;
  canManage: boolean;
  hasClients: boolean;
  /** The register's pager, rendered by the server page under the table. */
  pager: ReactNode;
}

export function ProposalsClient({
  items,
  hasAnyProposal,
  view,
  canManage,
  hasClients,
  pager,
}: ProposalsClientProps) {
  const t = useTranslations('proposals');
  const router = useRouter();
  const search = useProposalSearch(view);

  const newButton = canManage && hasClients && (
    <Button variant="default" onClick={() => router.push('/proposals/new')}>
      <Plus className="size-4" aria-hidden />
      {t('actions.new')}
    </Button>
  );

  if (!hasAnyProposal) {
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
            value={search.typed}
            onChange={(e) => search.setTyped(e.target.value)}
            placeholder={t('search')}
            className="ps-9"
          />
        </div>
        {newButton && <div className="ms-auto">{newButton}</div>}
      </div>

      <Card aria-busy={search.pending} className={search.pending ? 'opacity-60 transition-opacity' : undefined}>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b text-caption text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t('table.number')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.title')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.client')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.status')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('table.total')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <ProposalRow key={p.id} row={p} />
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {pager}
    </div>
  );
}
