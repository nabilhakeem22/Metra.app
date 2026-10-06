'use client';

import { Building2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { deactivationCopy, useActiveToggle } from '@/hooks/use-active-toggle';
import { useOpenOnArrival } from '@/hooks/use-open-on-arrival';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import { setClientActive } from '@/lib/clients/actions';
import { cityOptions, filterClients, type ClientFilter } from './client-filters';
import { ClientForm } from './client-form';
import { ClientsTable } from './clients-table';
import { ClientsToolbar } from './clients-toolbar';
import type { ClientRow } from './types';

export interface ClientsClientProps {
  items: ClientRow[];
  canManage: boolean;
  /** Reached through `/clients?new=1`: open the new-client form once. */
  openCreateOnArrival: boolean;
}

/** 'all' for both filters, so the list opens showing everything. */
const NO_FILTER: ClientFilter = { query: '', status: 'all', city: 'all' };

export function ClientsClient({ items, canManage, openCreateOnArrival }: ClientsClientProps) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const locale = useLocale();

  const [filter, setFilter] = useState<ClientFilter>(NO_FILTER);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);

  const cities = useMemo(() => cityOptions(items, locale), [items, locale]);
  const filtered = useMemo(() => filterClients(items, filter), [items, filter]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  useOpenOnArrival(canManage && openCreateOnArrival, openNew);

  const activeToggle = useActiveToggle({
    setActive: setClientActive,
    copy: deactivationCopy(t, tc),
    onError: (result) =>
      toast({ title: resolveActionError(result.error, te), variant: 'destructive' }),
  });

  const form = canManage && (
    <>
      <ClientForm open={formOpen} onOpenChange={setFormOpen} item={editing} />
      {activeToggle.dialog}
    </>
  );

  if (items.length === 0) {
    return (
      <>
        {form}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<Building2 className="size-6" aria-hidden />}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                canManage ? (
                  <Button variant="default" data-tour="clients-new" onClick={openNew}>
                    <Plus className="size-4" aria-hidden />
                    {t('actions.new')}
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {form}

      <ClientsToolbar
        filter={filter}
        onFilterChange={setFilter}
        cities={cities}
        canManage={canManage}
        onNew={openNew}
      />

      <ClientsTable
        clients={filtered}
        canManage={canManage}
        pending={activeToggle.pending}
        handlers={{
          onEdit: (client) => {
            setEditing(client);
            setFormOpen(true);
          },
          onToggleActive: (client) => void activeToggle.toggle(client),
        }}
      />
    </div>
  );
}
