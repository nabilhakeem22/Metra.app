'use client';

import { useLocale } from 'next-intl';
import type { KeyboardEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import type { BoqDetail } from '@/lib/boqs/queries';
import { formatMoney } from '@/lib/format/money';
import { BoqSheetFooter, BoqSheetHeader } from './boq-sheet-chrome';
import type { Column, EditableLine } from './boq-sheet-columns';
import { focusNextInColumn } from './boq-sheet-focus';
import { BoqSheetHead } from './boq-sheet-head';
import type { BoqSheetRowApi } from './boq-sheet-row-api';
import { countVisibleLines, searchNeedle, visibleLines } from './boq-sheet-search';
import { BoqSectionBody } from './boq-sheet-section';
import { BoqTotals } from './boq-sheet-totals';
import { useBoqEdits } from './use-boq-edits';
import { useBoqWrites } from './use-boq-writes';

/**
 * The BOQ as one sheet — COMPOSITION ONLY. What each piece owns is in the file
 * named after it: columns, focus, search, edits, writes, head, chrome, section,
 * row, cells, totals.
 *
 * The frame holds still while you work in it — the column header is pinned, the
 * totals are pinned, and the code and description columns stay put while the
 * money scrolls sideways. Losing track of which line you are on is how a wide
 * sheet becomes unusable, and a BOQ is a wide document.
 */
export function BoqSheet({
  boq,
  canEdit,
  actions,
}: {
  boq: BoqDetail;
  /** Draft + the boq_build capability. An issued sheet has no inputs at all. */
  canEdit: boolean;
  /** Issue / download controls — owned by the tab, rendered in this header. */
  actions?: ReactNode;
}) {
  const locale = useLocale();
  const edits = useBoqEdits();
  const writes = useBoqWrites({ boq, edits });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLTableElement>(null);

  const money = (value: string) => formatMoney(value, locale);
  const needle = searchNeedle(query);

  /**
   * Enter walks DOWN the column, which is how a rate list is actually typed.
   * Tab still moves across. Escape puts the cell back and writes nothing.
   */
  function onKeyDown(
    event: KeyboardEvent<HTMLElement>,
    line: EditableLine,
    column: Column,
  ): void {
    if (event.key === 'Escape') {
      edits.clearColumns(line.id, [column]);
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    focusNextInColumn(gridRef.current, column, event.currentTarget);
  }

  function toggleSection(sectionId: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  const colCount = canEdit ? 8 : 7;
  const rowApi: BoqSheetRowApi = { canEdit, money, onKeyDown, ...edits, ...writes };

  return (
    <div className="overflow-hidden rounded-[var(--r-panel,20px)] border border-[color:var(--rule)] bg-card shadow-sm">
      <BoqSheetHeader
        boq={boq}
        visibleCount={countVisibleLines(boq, needle)}
        query={query}
        onQueryChange={setQuery}
        actions={actions}
      />

      {/* A BOUNDED height is what makes the pinned header and pinned totals
          actually pin — inside an unbounded scroll container they scroll straight
          off the top of the screen. */}
      <div className="max-h-[min(58vh,520px)] overflow-auto">
        <table
          ref={gridRef}
          className="w-full min-w-[880px] border-separate border-spacing-0 text-sm"
        >
          <BoqSheetHead canEdit={canEdit} />

          {boq.sections.map((section) => (
            <BoqSectionBody
              key={section.id}
              section={section}
              lines={visibleLines(section, needle)}
              collapsed={collapsed.has(section.id)}
              colCount={colCount}
              searching={needle !== ''}
              api={rowApi}
              onToggle={() => toggleSection(section.id)}
            />
          ))}

          <BoqTotals
            boq={boq}
            canEdit={canEdit}
            colCount={colCount}
            money={money}
            discount={edits.discount}
            onDiscountChange={edits.setDiscount}
            onDiscountBlur={writes.onDiscountBlur}
          />
        </table>
      </div>

      {canEdit && (
        <BoqSheetFooter
          savingCount={edits.savingCount}
          pending={writes.pending}
          onAddSection={writes.onAddSection}
        />
      )}
    </div>
  );
}
