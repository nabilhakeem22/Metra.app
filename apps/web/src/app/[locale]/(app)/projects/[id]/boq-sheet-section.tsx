'use client';

import { ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { BoqSectionRow } from '@/lib/boqs/queries';
import { leadingColumnCount, type CellEdits, type EditableLine } from './boq-sheet-columns';
import { BoqSheetRow } from './boq-sheet-row';
import type { BoqSheetRowApi } from './boq-sheet-row-api';

// ONE TABLE, NOT ONE PER SECTION. Sections are rows in the same sheet, so reading
// the document top to bottom is one scroll, and the section subtotal lands in the
// Amount column with the numbers it sums rather than floating off at the end of
// its own card.

/** The dashed 'add' affordance, shared by the add-line and add-section buttons. */
export const BOQ_ADD_BUTTON_CLASS =
  'inline-flex items-center gap-2 rounded-pill border border-dashed border-[color:var(--rule)] px-4 py-2 text-small font-semibold text-[color:var(--brand-ink)] hover:border-[color:hsl(var(--brand))] hover:bg-[color:var(--brand-tint)]';

const BAND = 'border-y border-[color:var(--rule)] bg-[color:var(--track)]';

export function BoqSectionHeaderRow({
  section,
  collapsed,
  colCount,
  discounted,
  money,
  onToggle,
}: {
  section: BoqSectionRow;
  collapsed: boolean;
  colCount: number;
  discounted: boolean;
  money: (value: string) => string;
  onToggle: () => void;
}) {
  const leading = leadingColumnCount(discounted);
  return (
    <tr>
      <td colSpan={leading} className={BAND}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          // Pinned to the inline start of its own spanning cell: without this the
          // title scrolls out sideways and the section reads as an empty grey
          // band with a number in it.
          style={{ position: 'sticky', insetInlineStart: 0, width: 'fit-content' }}
          className="flex items-center gap-2 p-3 text-start font-bold text-[color:var(--text)]"
        >
          <ChevronDown
            className={`size-3.5 text-[color:var(--text-faint)] transition-transform ${collapsed ? '-rotate-90 rtl:rotate-90' : ''}`}
            aria-hidden
          />
          <span dir="auto">{section.title}</span>
          <span className="font-mono text-caption font-semibold tabular-nums text-[color:var(--text-faint)]">
            {section.lines.length}
          </span>
        </button>
      </td>
      <td
        className={`${BAND} whitespace-nowrap p-3 text-end font-mono text-small font-bold tabular-nums text-[color:var(--text-muted)]`}
        dir="ltr"
      >
        {money(section.sectionSubtotal)}
      </td>
      <td colSpan={colCount - leading - 1} className={BAND} />
    </tr>
  );
}

export function BoqSectionBody({
  section,
  lines,
  collapsed,
  colCount,
  discounted,
  searching,
  api,
  cells,
  savingIds,
  pending,
  onToggle,
}: {
  section: BoqSectionRow;
  /** The section's lines AFTER the search filter — what this body renders. */
  lines: EditableLine[];
  collapsed: boolean;
  colCount: number;
  /** This BOQ has line discounts: one more leading column. */
  discounted: boolean;
  /** While a search is running the add-line row is hidden: a new blank line would
   *  not match the query and would appear to do nothing. */
  searching: boolean;
  api: BoqSheetRowApi;
  /** The whole sheet's local edits. Each row is handed ONLY its own slice, whose
   *  identity changes only when that row changes — which is what lets a memoised
   *  row skip a keystroke typed into a different one. */
  cells: CellEdits;
  /** The rows mid-save. */
  savingIds: ReadonlySet<string>;
  /** SOME write on the sheet is in flight. */
  pending: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('projects.profile.boq');
  return (
    <tbody>
      <BoqSectionHeaderRow
        section={section}
        collapsed={collapsed}
        colCount={colCount}
        discounted={discounted}
        money={api.money}
        onToggle={onToggle}
      />
      {!collapsed &&
        lines.map((line) => (
          <BoqSheetRow
            key={line.id}
            line={line}
            api={api}
            typed={cells[line.id]}
            saving={savingIds.has(line.id)}
            pending={pending}
            discounted={discounted}
          />
        ))}
      {api.canEdit && !collapsed && !searching && (
        <tr>
          <td colSpan={colCount} className="p-2 ps-4">
            <button
              type="button"
              onClick={() => api.onAddLine(section.id)}
              disabled={pending}
              className={BOQ_ADD_BUTTON_CLASS}
            >
              <Plus className="size-3.5" aria-hidden />
              {t('addLine')}
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}
