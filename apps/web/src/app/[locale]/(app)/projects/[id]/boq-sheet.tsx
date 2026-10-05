'use client';

import type { ReactNode } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { BoqDetail } from '@/lib/boqs/queries';
import { hasLineDiscounts } from '@/lib/boqs/line-discounts';
import { BoqSheetFooter, BoqSheetHeader } from './boq-sheet-chrome';
import { sheetColumnCount } from './boq-sheet-columns';
import { BoqSheetHead } from './boq-sheet-head';
import { countVisibleLines, searchNeedle, visibleLines } from './boq-sheet-search';
import { BoqSectionBody } from './boq-sheet-section';
import { BoqTotals } from './boq-sheet-totals';
import { useBoqEdits } from './use-boq-edits';
import { useBoqRowApi } from './use-boq-row-api';
import { useBoqWrites } from './use-boq-writes';

/**
 * The BOQ as one sheet — COMPOSITION ONLY. What each piece owns is in the file
 * named after it: columns, focus, search, edits, writes, row api, head, chrome,
 * section, row, cells, totals.
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
  const edits = useBoqEdits();
  const writes = useBoqWrites({ boq, edits });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLTableElement>(null);
  const rowApi = useBoqRowApi({ canEdit, edits, writes, gridRef });

  const needle = searchNeedle(query);
  // Line discounts are shown only when the studio gave one (owner decision): the
  // discount column exists for THIS BOQ only if some line carries a discount.
  const discounted = useMemo(() => hasLineDiscounts(boq.sections), [boq]);
  const colCount = sheetColumnCount(discounted, canEdit);

  const toggleSection = useCallback((sectionId: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }, []);

  /**
   * THE FILTERED ROWS, computed once per (boq, query) rather than per render.
   * Identity matters here as much as cost: `visibleLines` rebuilds every line
   * object, so a fresh array per keystroke would hand every memoised row a new
   * `line` and defeat the memo entirely.
   */
  const bodies = useMemo(
    () =>
      boq.sections.map((section) => ({
        section,
        lines: visibleLines(section, needle),
      })),
    [boq, needle],
  );
  const visibleCount = useMemo(() => countVisibleLines(boq, needle), [boq, needle]);

  return (
    <div className="overflow-hidden rounded-[var(--r-panel,20px)] border border-[color:var(--rule)] bg-card shadow-sm">
      <BoqSheetHeader
        boq={boq}
        visibleCount={visibleCount}
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
          <BoqSheetHead canEdit={canEdit} discounted={discounted} />

          {bodies.map(({ section, lines }) => (
            <BoqSectionBody
              key={section.id}
              section={section}
              lines={lines}
              collapsed={collapsed.has(section.id)}
              colCount={colCount}
              discounted={discounted}
              searching={needle !== ''}
              api={rowApi}
              cells={edits.cells}
              savingIds={edits.savingIds}
              pending={writes.pending}
              onToggle={() => toggleSection(section.id)}
            />
          ))}

          <BoqTotals
            boq={boq}
            canEdit={canEdit}
            colCount={colCount}
            discounted={discounted}
            money={rowApi.money}
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
