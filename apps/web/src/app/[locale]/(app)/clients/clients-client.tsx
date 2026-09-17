'use client';

import { Building2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { setClientActive } from '@/lib/clients/actions';
import { cityOptions, filterClients, type ClientFilter } from './client-filters';
import { ClientForm } from './client-form';
import { ClientsTable } from './clients-table';
import { ClientsToolbar } from './clients-toolbar';
import type { ClientRow } from './types';

export interface ClientsClientProps {
  items: ClientRow[];
  canManage: boolean;
}

/** 'all' for both filters, so the list opens showing everything. */
const NO_FILTER: ClientFilter = { query: '', status: 'all', city: 'all' };

export function ClientsClient({ items, canManage }: ClientsClientProps) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const locale = useLocale();

  const [filter, setFilter] = useState<ClientFilter>(NO_FILTER);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [pending, startTransition] = useTransition();

  const cities = useMemo(() => cityOptions(items, locale), [items, locale]);
  const filtered = useMemo(() => filterClients(items, filter), [items, filter]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function toggleActive(item: ClientRow) {
    startTransition(async () => {
      const result = await setClientActive(item.id, !item.active);
      toast(
        result.ok
          ? { title: t(item.active ? 'toast.deactivated' : 'toast.activated') }
          : {
              title: resolveActionError(result.error as ActionCode, te),
              variant: 'destructive',
            },
      );
    });
  }

  const form = canManage && (
    <ClientForm open={formOpen} onOpenChange={setFormOpen} item={editing} />
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
                  <Button data-tour="clients-new" onClick={openNew}>
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
        pending={pending}
        handlers={{
          onEdit: (client) => {
            setEditing(client);
            setFormOpen(true);
          },
          onToggleActive: toggleActive,
        }}
      />
    </div>
  );
}
