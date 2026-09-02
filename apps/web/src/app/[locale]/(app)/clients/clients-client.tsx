'use client';

import { Building2, Pencil, Plus, Power, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Link } from '@/i18n/routing';
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
  // Spec: filter by STATUS and CITY. 'all' is the resting state for both, so the
  // list opens showing everything rather than a silently narrowed subset.
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [city, setCity] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [pending, startTransition] = useTransition();

  // Every city present in the data, for the filter. Derived rather than configured:
  // a firm's cities are whatever its clients are in.
  const cities = useMemo(
    () =>
      [...new Set(items.map((c) => c.city?.trim()).filter((v): v is string => !!v))].sort(
        (a, b) => a.localeCompare(b, locale),
      ),
    [items, locale],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((c) => {
      if (status === 'active' && !c.active) return false;
      if (status === 'inactive' && c.active) return false;
      if (city !== 'all' && (c.city?.trim() ?? '') !== city) return false;
      if (needle) {
        // Spec: search by NAME and EMAIL.
        const hay = `${c.nameEn ?? ''} ${c.nameAr ?? ''} ${c.email ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, status, city]);

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
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label={t('table.status')}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">{t('filter.allStatuses')}</option>
          <option value="active">{t('status.active')}</option>
          <option value="inactive">{t('status.inactive')}</option>
        </select>
        <select
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-label={t('table.city')}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="all">{t('filter.allCities')}</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {canManage && (
          <Button data-tour="clients-new" className="ms-auto" onClick={openNew}>
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
                  <th className="px-4 py-2 text-start font-medium">{t('table.type')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.contactDetails')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.city')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('table.projects')}</th>
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
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={`/clients/${c.id}`}
                          className="hover:underline"
                        >
                          {name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {c.contactName || '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {t(`types.${c.type}`)}
                      </td>
                      {/* Email and phone share one column: they are the same fact
                          (how to reach them) and two columns pushed the table wide. */}
                      <td className="px-4 py-2 text-muted-foreground">
                        <span dir="ltr" className="block">
                          {c.email || '—'}
                        </span>
                        <span dir="ltr" className="block text-xs">
                          {c.phone || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{c.city || '—'}</td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground" dir="ltr">
                        {c.projectCount}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            c.active
                              ? 'rounded-full bg-[color:var(--success-tint)] px-2 py-0.5 text-xs text-[color:var(--success)]'
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
