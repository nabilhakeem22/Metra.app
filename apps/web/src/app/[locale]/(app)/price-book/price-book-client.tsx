'use client';

import { useMemo, useState } from 'react';
import { BulkUpdateDialog } from './bulk-update-dialog';
import { CostItemForm } from './cost-item-form';
import { ImportWizard } from './import-wizard';
import { PriceBookEmpty } from './price-book-empty';
import {
  filterCostItems,
  groupBySection,
  type PriceBookFilter,
} from './price-book-filters';
import { PriceBookTable } from './price-book-table';
import { PriceBookToolbar } from './price-book-toolbar';
import type { PriceBookItem, SectionOption } from './types';
import { usePriceBookActions } from './use-price-book-actions';

export interface PriceBookClientProps {
  items: PriceBookItem[];
  sections: SectionOption[];
  canManage: boolean;
}

/** Everything visible by default: the book is a catalogue, not a filtered view. */
const NO_FILTER: PriceBookFilter = { query: '', sectionId: 'all', activeOnly: false };

export function PriceBookClient({ items, sections, canManage }: PriceBookClientProps) {
  const [filter, setFilter] = useState<PriceBookFilter>(NO_FILTER);
  const [newSection, setNewSection] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBookItem | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const actions = usePriceBookActions();

  const groups = useMemo(
    () => groupBySection(filterCostItems(items, filter), sections),
    [items, filter, sections],
  );

  // The four dialogs stay CHILDREN of this component: each is a Radix portal
  // whose open state belongs to the page, not to the toolbar button that opens it.
  const dialogs = canManage && (
    <>
      <CostItemForm
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        sections={sections}
      />
      <BulkUpdateDialog open={bulkOpen} onOpenChange={setBulkOpen} sections={sections} />
      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={items.map((item) => item.code)}
        sections={sections}
      />
    </>
  );

  if (items.length === 0) {
    return (
      <>
        {dialogs}
        <PriceBookEmpty
          canManage={canManage}
          pending={actions.pending}
          onLoadStarter={actions.loadStarter}
          onImport={() => setImportOpen(true)}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      {dialogs}

      <PriceBookToolbar
        q={filter.query}
        onQChange={(query) => setFilter({ ...filter, query })}
        sectionFilter={filter.sectionId}
        onSectionFilterChange={(sectionId) => setFilter({ ...filter, sectionId })}
        activeOnly={filter.activeOnly}
        onActiveOnlyChange={(activeOnly) => setFilter({ ...filter, activeOnly })}
        sections={sections}
        canManage={canManage}
        newSection={newSection}
        onNewSectionChange={setNewSection}
        onAddSection={() => actions.addNewSection(newSection, () => setNewSection(''))}
        pending={actions.pending}
        onBulkUpdate={() => setBulkOpen(true)}
        onImport={() => setImportOpen(true)}
        onNew={() => {
          setEditing(null);
          setFormOpen(true);
        }}
      />

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
    </div>
  );
}
