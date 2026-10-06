'use client';

import { Compass, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useOpenOnArrival } from '@/hooks/use-open-on-arrival';
import type { ClientOption } from '@/lib/clients/queries';
import type { EngagementListRow } from '@/lib/engagements/queries';
import {
  EngagementCreateForm,
  type ProjectOption,
} from './engagement-create-form';
import { EngagementsList } from './engagements-list';

export function EngagementsClient({
  items,
  clientOptions,
  projectOptions,
  canCreate,
  openCreateOnArrival,
  nowIso,
}: {
  items: EngagementListRow[];
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
  canCreate: boolean;
  /** Reached through `/engagements?new=1`: open the create sheet once. */
  openCreateOnArrival: boolean;
  /** The server's "now", so every row's age and the hydrated page agree. */
  nowIso: string;
}) {
  const t = useTranslations('engagements');
  const [creating, setCreating] = useState(false);
  useOpenOnArrival(canCreate && openCreateOnArrival, () => setCreating(true));

  const newButton = canCreate && (
    <Button onClick={() => setCreating(true)}>
      <Plus className="size-4" aria-hidden />
      {t('startDelivery')}
    </Button>
  );

  return (
    <div className="space-y-4">
      {newButton && <div className="flex"><div className="ms-auto">{newButton}</div></div>}

      {items.length === 0 ? (
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

      {canCreate && (
        <EngagementCreateForm
          open={creating}
          onOpenChange={setCreating}
          clientOptions={clientOptions}
          projectOptions={projectOptions}
        />
      )}
    </div>
  );
}
