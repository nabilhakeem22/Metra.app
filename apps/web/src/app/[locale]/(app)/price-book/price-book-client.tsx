'use client';

import {
  BookText,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Power,
  Search,
  Upload,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import {
  loadStarterCatalogue,
  setCostItemActive,
} from '@/lib/price-book/actions';
import { CATEGORY_TOKENS } from '@/lib/price-book/import';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { CostItemForm } from './cost-item-form';
import { ImportWizard } from './import-wizard';
import type { PriceBookItem } from './types';

export interface PriceBookClientProps {
  items: PriceBookItem[];
  canManage: boolean;
}

export function PriceBookClient({ items, canManage }: PriceBookClientProps) {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const locale = useLocale();

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBookItem | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== 'all' && i.category !== category) return false;
      if (activeOnly && !i.active) return false;
      if (needle) {
        const hay = `${i.code} ${i.nameEn ?? ''} ${i.nameAr ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, category, activeOnly]);

  const grouped = useMemo(() => {
    return CATEGORY_TOKENS.map((cat) => ({
      category: cat,
      rows: filtered.filter((i) => i.category === cat),
    })).filter((g) => g.rows.length > 0);
  }, [filtered]);

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(item: PriceBookItem) {
    setEditing(item);
    setFormOpen(true);
  }

  function toggleActive(item: PriceBookItem) {
    startTransition(async () => {
      const res = await setCostItemActive(item.id, !item.active);
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

  function onLoadStarter() {
    startTransition(async () => {
      const res = await loadStarterCatalogue();
      if (res.ok) {
        toast({
          title:
            (res.data?.inserted ?? 0) > 0
              ? t('toast.starterLoaded', { count: res.data?.inserted ?? 0 })
              : t('toast.starterExists'),
        });
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  const dialogs = canManage && (
    <>
      <CostItemForm open={formOpen} onOpenChange={setFormOpen} item={editing} />
      <BulkUpdateDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={items.map((i) => i.code)}
      />
    </>
  );

  if (items.length === 0) {
    return (
      <>
        {dialogs}
        <Card>
          <CardContent className="py-4">
            <EmptyState
              icon={<BookText className="size-6" aria-hidden />}
              title={t('empty.title')}
              description={t('empty.description')}
              action={
                canManage ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button data-tour="price-book-new" onClick={onLoadStarter} disabled={pending}>
                      {pending && (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      )}
                      {t('empty.loadStarter')}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setImportOpen(true)}
                    >
                      <Upload className="size-4" aria-hidden />
                      {t('empty.importExcel')}
                    </Button>
                  </div>
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
      {dialogs}

      {/* Toolbar */}
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
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label={t('table.category')}
        >
          <option value="all">{t('allCategories')}</option>
          {CATEGORY_TOKENS.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          {t('activeOnly')}
        </label>

        {canManage && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <Percent className="size-4" aria-hidden />
              {t('actions.bulkUpdate')}
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden />
              {t('actions.import')}
            </Button>
            <Button data-tour="price-book-new" onClick={openNew}>
              <Plus className="size-4" aria-hidden />
              {t('actions.new')}
            </Button>
          </div>
        )}
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState title={t('empty.title')} />
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
          <Card key={group.category}>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <h2 className="text-sm font-semibold">
                  {t(`categories.${group.category}`)}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t('itemsCount', { count: group.rows.length })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-start font-medium">
                        {t('table.code')}
                      </th>
                      <th className="px-4 py-2 text-start font-medium">
                        {t('table.name')}
                      </th>
                      <th className="px-4 py-2 text-start font-medium">
                        {t('table.unit')}
                      </th>
                      <th className="px-4 py-2 text-end font-medium">
                        {t('table.cost')}
                      </th>
                      <th className="px-4 py-2 text-end font-medium">
                        {t('table.price')}
                      </th>
                      <th className="px-4 py-2 text-start font-medium">
                        {t('table.status')}
                      </th>
                      {canManage && <th className="px-4 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((item) => {
                      const name = pickLocale(
                        { nameAr: item.nameAr, nameEn: item.nameEn },
                        'name',
                        locale,
                      ).value;
                      return (
                        <tr
                          key={item.id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="px-4 py-2 font-mono text-xs" dir="ltr">
                            {item.code}
                          </td>
                          <td className="px-4 py-2">{name}</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {t(`units.${item.unit}`)}
                          </td>
                          <td className="px-4 py-2 num text-end" dir="ltr">{formatMoney(item.defaultUnitCost, locale)}
                          </td>
                          <td className="px-4 py-2 num text-end" dir="ltr">{formatMoney(item.defaultUnitPrice, locale)}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={
                                item.active
                                  ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600'
                                  : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                              }
                            >
                              {t(item.active ? 'status.active' : 'status.inactive')}
                            </span>
                          </td>
                          {canManage && (
                            <td className="px-4 py-2">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEdit(item)}
                                  aria-label={t('actions.edit')}
                                >
                                  <Pencil className="size-4" aria-hidden />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => toggleActive(item)}
                                  disabled={pending}
                                  aria-label={t(
                                    item.active
                                      ? 'actions.deactivate'
                                      : 'actions.activate',
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
        ))
      )}
    </div>
  );
}
