'use client';

import { useState } from 'react';
import type { PriceBookView } from '@/lib/price-book/page-params';
import { cn } from '@/lib/utils';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { CostItemForm } from './cost-item-form';
import { ImportWizard } from './import-wizard';
import { PriceBookEmpty } from './price-book-empty';
import { groupPageRows } from './price-book-groups';
import { PriceBookPager } from './price-book-pager';
import { PriceBookTable } from './price-book-table';
import { PriceBookToolbar } from './price-book-toolbar';
import type { PriceBookItem, PriceBookPageData, SectionOption } from './types';
import { usePriceBookActions } from './use-price-book-actions';
import { usePriceBookNavigation } from './use-price-book-navigation';

export interface PriceBookClientProps {
  view: PriceBookView;
  book: PriceBookPageData;
  sections: SectionOption[];
  canManage: boolean;
}

/** The section select's "every section" value; the URL leaves ?section out instead. */
const ALL_SECTIONS = 'all';

/**
 * One page of the price book (the server filtered, searched and paged it), its
 * toolbar and its pager. Every filter is in the URL (use-price-book-navigation).
 */
export function PriceBookClient({ view, book, sections, canManage }: PriceBookClientProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBookItem | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const actions = usePriceBookActions();
  const navigation = usePriceBookNavigation(view);
  const groups = groupPageRows(book.rows, sections, book.sectionCounts);

  // The four dialogs stay CHILDREN of this component: each is a Radix portal
  // whose open state belongs to the page, not to the toolbar button that opens it.
  const dialogs = canManage && (
    <>
      <CostItemForm open={formOpen} onOpenChange={setFormOpen} item={editing} sections={sections} />
      <BulkUpdateDialog open={bulkOpen} onOpenChange={setBulkOpen} sections={sections} />
      <ImportWizard open={importOpen} onOpenChange={setImportOpen} sections={sections} />
      {actions.confirmDialog}
    </>
  );

  if (!book.hasAnyItem) {
    return (
      <>
        {dialogs}
        <PriceBookEmpty
          canManage={canManage}
          pending={actions.pending}
          onLoadMarketBook={actions.loadMarketBook}
          onImport={() => setImportOpen(true)}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {dialogs}

      <PriceBookToolbar
        q={navigation.query}
        onQChange={navigation.setQuery}
        sectionFilter={navigation.sectionId ?? ALL_SECTIONS}
        onSectionFilterChange={(sectionId) => navigation.setSectionId(sectionId === ALL_SECTIONS ? null : sectionId)}
        activeOnly={navigation.activeOnly}
        onActiveOnlyChange={navigation.setActiveOnly}
        sections={sections}
        canManage={canManage}
        onBulkUpdate={() => setBulkOpen(true)}
        onImport={() => setImportOpen(true)}
        onNew={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

      <div
        aria-busy={navigation.pending}
        className={cn('space-y-4 transition-opacity motion-reduce:transition-none', navigation.pending && 'opacity-60')}
      >
        <PriceBookTable
          groups={groups}
          canManage={canManage}
          pending={actions.pending}
          onEdit={(item) => {
            setEditing(item);
            setFormOpen(true);
          }}
          onToggleActive={actions.toggleActive}
        />
        <PriceBookPager view={view} page={book.page} pageCount={book.pageCount} matched={book.matched} />
      </div>
    </div>
  );
}
