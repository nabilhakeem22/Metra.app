'use client';

import { Compass, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useOpenOnArrival } from '@/hooks/use-open-on-arrival';
import type { ClientOption } from '@/lib/clients/queries';
import type { EngagementListRow } from '@/lib/engagements/queries';
import { formatNumber } from '@/lib/format/number';
import {
  EngagementCreateForm,
  type ProjectOption,
} from './engagement-create-form';
import { EngagementsList } from './engagements-list';
import { EngagementsMoveFilter } from './engagements-move-filter';
import { EngagementsPager } from './engagements-pager';

export function EngagementsClient({
  items,
  paging,
  view,
  clientOptions,
  projectOptions,
  canCreate,
  setupLinks,
  openCreateOnArrival,
  nowIso,
}: {
  items: EngagementListRow[];
  /** Where the list stands in the keyset pages. */
  paging: { nextBefore: number | null; isFirstPage: boolean };
  /** "My move" or all; `truncatedAt` = how many it looked through when more exist. */
  view: { mine: boolean; truncatedAt: number | null };
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
  canCreate: boolean;
  /** May this role add the client / project a delivery needs (the form's empty states)? */
  setupLinks: { canAddClient: boolean; canAddProject: boolean };
  /** Reached through `/engagements?new=1`: open the create sheet once. */
  openCreateOnArrival: boolean;
  /** The server's "now", so every row's age and the hydrated page agree. */
  nowIso: string;
}) {
  const t = useTranslations('engagements');
  const locale = useLocale();
  const [creating, setCreating] = useState(false);
  useOpenOnArrival(canCreate && openCreateOnArrival, () => setCreating(true));

  const newButton = canCreate && (
    <Button variant="default" onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden />
      {t('startDelivery')}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EngagementsMoveFilter mine={view.mine} />
        {newButton && <div className="ms-auto">{newButton}</div>}
      </div>

      {items.length === 0 && view.mine ? (
        <Card>
          <CardContent className="py-4">
            {/* Past the scan limit "nothing is waiting" would be a claim about
                deliveries never looked at: say what was checked instead. */}
            <EmptyState
              icon={<Compass className="size-6" aria-hidden />}
              title={
                view.truncatedAt === null
                  ? t('list.mineEmpty')
                  : t('list.mineEmptyPartial', { count: formatNumber(view.truncatedAt, locale) })
              }
            />
          </CardContent>
        </Card>
      ) : items.length === 0 && paging.isFirstPage ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<Compass className="size-6" aria-hidden />}
              title={t('title')}
              description={t('empty')}
              action={newButton || undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <EngagementsList items={items} now={new Date(nowIso)} />
          </CardContent>
        </Card>
      )}
      {view.truncatedAt !== null && items.length > 0 && (
        <p className="text-caption text-muted-foreground">
          {t('list.truncated', { count: formatNumber(view.truncatedAt, locale) })}
        </p>
      )}
      {!view.mine && (paging.nextBefore !== null || !paging.isFirstPage) && (
        <EngagementsPager nextBefore={paging.nextBefore} isFirstPage={paging.isFirstPage} />
      )}

      {canCreate && (
        <EngagementCreateForm
          open={creating}
          onOpenChange={setCreating}
          clientOptions={clientOptions}
          projectOptions={projectOptions}
          setupLinks={setupLinks}
        />
      )}
    </div>
  );
}
