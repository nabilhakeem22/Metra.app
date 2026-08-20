'use client';

import { BookText, Loader2, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  loadStarterCatalogue,
  setCostItemActive,
} from '@/lib/price-book/actions';
import { addSection } from '@/lib/sections/actions';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { CostItemForm } from './cost-item-form';
import { ImportWizard } from './import-wizard';
import { PriceBookTable } from './price-book-table';
import { PriceBookToolbar } from './price-book-toolbar';
import type { PriceBookItem, SectionOption } from './types';

export interface PriceBookClientProps {
  items: PriceBookItem[];
  sections: SectionOption[];
  canManage: boolean;
}

export function PriceBookClient({
  items,
  sections,
  canManage,
}: PriceBookClientProps) {
  const t = useTranslations('priceBook');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();

  const [q, setQ] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [newSection, setNewSection] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBookItem | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (sectionFilter !== 'all' && i.sectionId !== sectionFilter) return false;
      if (activeOnly && !i.active) return false;
      if (needle) {
        const hay = `${i.code} ${i.nameEn ?? ''} ${i.nameAr ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, q, sectionFilter, activeOnly]);

  const grouped = useMemo(() => {
    return sections
      .map((s) => ({
        section: s,
        rows: filtered.filter((i) => i.sectionId === s.id),
      }))
      .filter((g) => g.rows.length > 0);
  }, [filtered, sections]);

  function onAddSection() {
    const name = newSection.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await addSection(
        locale.startsWith('ar') ? { nameAr: name } : { nameEn: name },
      );
      if (res.ok) {
        setNewSection('');
        toast({ title: t('toast.sectionAdded') });
        router.refresh();
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

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
      <CostItemForm
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        sections={sections}
      />
      <BulkUpdateDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        sections={sections}
      />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={items.map((i) => i.code)}
        sections={sections}
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

      <PriceBookToolbar
        q={q}
        onQChange={setQ}
        sectionFilter={sectionFilter}
        onSectionFilterChange={setSectionFilter}
        activeOnly={activeOnly}
        onActiveOnlyChange={setActiveOnly}
        sections={sections}
        canManage={canManage}
        newSection={newSection}
        onNewSectionChange={setNewSection}
        onAddSection={onAddSection}
        pending={pending}
        onBulkUpdate={() => setBulkOpen(true)}
        onImport={() => setImportOpen(true)}
        onNew={openNew}
      />

      <PriceBookTable
        groups={grouped}
        canManage={canManage}
        pending={pending}
        onEdit={openEdit}
        onToggleActive={toggleActive}
      />
    </div>
  );
}
