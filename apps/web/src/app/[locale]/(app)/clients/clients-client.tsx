'use client';

import { Building2, Pencil, Plus, Power, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { setClientActive } from '@/lib/clients/actions';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { ClientForm } from './client-form';
import type { ClientRow } from './types';

export interface ClientsClientProps {
  items: ClientRow[];
  canManage: boolean;
}

export function ClientsClient({ items, canManage }: ClientsClientProps) {
  const t = useTranslations('clients');
  const te = useTranslations('errors');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((c) => {
      if (activeOnly && !c.active) return false;
      if (needle) {
        const hay = `${c.nameEn ?? ''} ${c.nameAr ?? ''} ${c.contactName ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, activeOnly]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function toggleActive(item: ClientRow) {
    startTransition(async () => {
      const res = await setClientActive(item.id, !item.active);
      toast(
        res.ok
          ? { title: t(item.active ? 'toast.deactivated' : 'toast.activated') }
          : {
              title: resolveActionError(res.error as ActionCode, te),
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
                  <Button onClick={openNew}>
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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          {t('activeOnly')}
        </label>
        {canManage && (
          <Button className="ms-auto" onClick={openNew}>
            <Plus className="size-4" aria-hidden />
            {t('actions.new')}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t('table.name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.contact')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.email')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.city')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.status')}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const name = pickLocale(
                    { nameAr: c.nameAr, nameEn: c.nameEn },
                    'name',
                    locale,
                  ).value;
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">{name}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.contactName || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                        {c.email || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.city || '—'}</td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            c.active
                              ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600'
                              : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                          }
                        >
                          {t(c.active ? 'status.active' : 'status.inactive')}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditing(c);
                                setFormOpen(true);
                              }}
                              aria-label={t('actions.edit')}
                            >
                              <Pencil className="size-4" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => toggleActive(c)}
                              disabled={pending}
                              aria-label={t(
                                c.active ? 'actions.deactivate' : 'actions.activate',
                              )}
                            >
                              <Power className="size-4" aria-hidden />
                            </Button>
                          </div>
                        </td>
                      )}
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
