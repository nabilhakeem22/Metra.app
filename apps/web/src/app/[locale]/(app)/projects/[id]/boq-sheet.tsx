'use client';

import { ChevronDown, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { BOQ_UNITS } from '@/lib/boqs/edit-input';
import type { BoqDetail, BoqLineRow } from '@/lib/boqs/queries';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import { trimNumber, type Column, type EditableLine } from './boq-sheet-columns';
import { focusNextInColumn } from './boq-sheet-focus';
import { useBoqEdits } from './use-boq-edits';
import { useBoqWrites } from './use-boq-writes';

/**
 * The BOQ as one sheet.
 *
 * EVERY CELL IS THE INPUT. No drawer, no modal, no edit button per row: a studio
 * pricing a fit-out is doing data entry across dozens or hundreds of lines, and
 * one extra click multiplies by the row count.
 *
 * The frame holds still while you work in it — the column header is pinned, the
 * totals are pinned, and the code and description columns stay put while the
 * money scrolls sideways. Losing track of which line you are on is how a wide
 * sheet becomes unusable, and a BOQ is a wide document.
 *
 * ONE TABLE, NOT ONE PER SECTION. Sections are rows in the same sheet, so
 * reading the document top to bottom is one scroll, and the section subtotal
 * lands in the Amount column with the numbers it sums rather than floating off
 * at the end of its own card.
 *
 * SAVE IS PER LINE, ON BLUR. Not per keystroke — a half-typed rate ("15" on the
 * way to "1500") must never be written to a document a client will sign.
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
  const t = useTranslations('projects.profile.boq');
  const locale = useLocale();
  const edits = useBoqEdits();
  const writes = useBoqWrites({ boq, edits });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const gridRef = useRef<HTMLTableElement>(null);

  const money = (v: string) => formatMoney(v, locale);

  const lines: EditableLine[] = useMemo(
    () =>
      boq.sections.flatMap((s) =>
        s.lines.map((l) => ({ ...l, sectionId: s.id })),
      ),
    [boq.sections],
  );

  const needle = query.trim().toLowerCase();
  const matches = (l: BoqLineRow) =>
    needle === '' ||
    `${l.itemCode ?? ''} ${l.description}`.toLowerCase().includes(needle);
  const visibleCount = lines.filter(matches).length;

  /**
   * Enter walks DOWN the column, which is how a rate list is actually typed.
   * Tab still moves across. Escape puts the cell back and writes nothing.
   */
  function onKeyDown(e: KeyboardEvent<HTMLElement>, line: EditableLine, col: Column): void {
    if (e.key === 'Escape') {
      edits.clearColumns(line.id, [col]);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    focusNextInColumn(gridRef.current, col, e.currentTarget);
  }

  function toggleSection(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const colCount = canEdit ? 8 : 7;

  return (
    <div className="overflow-hidden rounded-[var(--r-panel,20px)] border border-[color:var(--rule)] bg-card shadow-sm">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--rule)] p-4">
        <div>
          <p className="flex items-center gap-2 font-bold text-[color:var(--text)]">
            <span dir="auto">{boq.title}</span>
            <span
              className="rounded-pill px-2 py-1 text-[11px] font-semibold uppercase"
              style={
                boq.status === 'issued'
                  ? { background: 'var(--success-tint)', color: 'var(--success)' }
                  : { background: 'var(--warn-tint)', color: 'var(--warn)' }
              }
            >
              {boq.status === 'issued' ? t('statusIssued') : t('statusDraft')}
            </span>
          </p>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {t('documentLabel', { number: String(boq.number) })} ·{' '}
            {t('lineCount', { count: visibleCount })}
          </p>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="flex min-w-[180px] items-center gap-2 rounded-pill border border-[color:var(--field-border)] bg-[color:var(--field-bg)] px-3 py-2">
            <Search className="size-4 shrink-0 text-[color:var(--text-faint)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('find')}
              aria-label={t('find')}
              className="w-full border-0 bg-transparent p-0 text-sm text-[color:var(--text)] outline-none"
            />
          </label>
          {actions}
        </div>
      </div>

      {/* the sheet. A BOUNDED height is what makes the pinned header and pinned
          totals actually pin — inside an unbounded scroll container they scroll
          straight off the top of the screen. */}
      <div className="max-h-[min(58vh,520px)] overflow-auto">
        <table
          ref={gridRef}
          className="w-full min-w-[880px] border-separate border-spacing-0 text-sm"
        >
          <colgroup>
            <col style={{ width: 72 }} />
            <col />
            <col style={{ width: 116 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 132 }} />
            <col style={{ width: 48 }} />
            {canEdit && <col style={{ width: 44 }} />}
          </colgroup>
          <thead>
            <tr>
              <Th sticky="a">{t('col.code')}</Th>
              <Th sticky="b">{t('col.description')}</Th>
              <Th>{t('col.unit')}</Th>
              <Th num>{t('col.qty')}</Th>
              <Th num>{t('col.rate')}</Th>
              <Th num>{t('col.total')}</Th>
              <Th>{t('col.provisionalShort')}</Th>
              {canEdit && <Th> </Th>}
            </tr>
          </thead>

          {boq.sections.map((section) => {
            const isCollapsed = collapsed.has(section.id);
            const sectionLines = section.lines
              .map((l) => ({ ...l, sectionId: section.id }))
              .filter(matches);
            return (
              <tbody key={section.id}>
                <tr>
                  <td
                    colSpan={5}
                    className="border-y border-[color:var(--rule)] bg-[color:var(--track)]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={!isCollapsed}
                      // Pinned to the inline start of its own spanning cell:
                      // without this the title scrolls out sideways and the
                      // section reads as an empty grey band with a number in it.
                      style={{ position: 'sticky', insetInlineStart: 0, width: 'fit-content' }}
                      className="flex items-center gap-2 p-3 text-start font-bold text-[color:var(--text)]"
                    >
                      <ChevronDown
                        className={`size-3.5 text-[color:var(--text-faint)] transition-transform ${isCollapsed ? '-rotate-90 rtl:rotate-90' : ''}`}
                        aria-hidden
                      />
                      <span dir="auto">{section.title}</span>
                      <span className="font-mono text-[11px] font-semibold text-[color:var(--text-faint)]">
                        {section.lines.length}
                      </span>
                    </button>
                  </td>
                  <td
                    className="whitespace-nowrap border-y border-[color:var(--rule)] bg-[color:var(--track)] p-3 text-end font-mono text-[13px] font-bold tabular-nums text-[color:var(--text-muted)]"
                    dir="ltr"
                  >
                    {money(section.sectionSubtotal)}
                  </td>
                  <td
                    colSpan={colCount - 6}
                    className="border-y border-[color:var(--rule)] bg-[color:var(--track)]"
                  />
                </tr>

                {!isCollapsed &&
                  sectionLines.map((line) => (
                    <tr
                      key={line.id}
                      className="group border-b border-[color:var(--rule-soft)]"
                    >
                      <Td sticky="a" dirty={edits.isDirty(line.id)}>
                        {canEdit ? (
                          <Cell
                            value={edits.cellValue(line, 'itemCode')}
                            onChange={(v) => edits.setCell(line.id, 'itemCode', v)}
                            onBlur={() => writes.onCellBlur(line, 'itemCode')}
                            onKeyDown={(e) => onKeyDown(e, line, 'itemCode')}
                            col="itemCode"
                            label={t('col.code')}
                            mono
                          />
                        ) : (
                          <span className="block p-3 font-mono text-[13px] text-[color:var(--text-muted)]">
                            {line.itemCode}
                          </span>
                        )}
                      </Td>
                      <Td sticky="b">
                        {canEdit ? (
                          <Cell
                            value={edits.cellValue(line, 'description')}
                            onChange={(v) => edits.setCell(line.id, 'description', v)}
                            onBlur={() => writes.onCellBlur(line, 'description')}
                            onKeyDown={(e) => onKeyDown(e, line, 'description')}
                            col="description"
                            label={t('col.description')}
                          />
                        ) : (
                          <span className="block p-3" dir="auto">
                            {line.description}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {canEdit ? (
                          <select
                            value={edits.cellValue(line, 'unit')}
                            data-col="unit"
                            aria-label={t('col.unit')}
                            onChange={(e) => {
                              edits.setCell(line.id, 'unit', e.target.value);
                              writes.saveLine(line, { unit: e.target.value }, ['unit']);
                            }}
                            className="w-full cursor-pointer rounded-[8px] border border-transparent bg-transparent p-3 text-sm text-[color:var(--text)] hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))] focus:outline-none"
                          >
                            {BOQ_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {t(`unit.${u}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="block p-3 text-[color:var(--text-muted)]">
                            {t(`unit.${line.unit}`)}
                          </span>
                        )}
                      </Td>
                      <Td num>
                        {canEdit ? (
                          <Cell
                            value={edits.cellValue(line, 'qty')}
                            onChange={(v) => edits.setCell(line.id, 'qty', v)}
                            onBlur={() => writes.onCellBlur(line, 'qty')}
                            onKeyDown={(e) => onKeyDown(e, line, 'qty')}
                            col="qty"
                            label={t('col.qty')}
                            mono
                            numeric
                          />
                        ) : (
                          <span
                            className="block whitespace-nowrap p-3 text-end font-mono tabular-nums"
                            dir="ltr"
                          >
                            {formatQuantity(line.qty, locale)}
                          </span>
                        )}
                      </Td>
                      <Td num>
                        {canEdit ? (
                          <Cell
                            value={edits.cellValue(line, 'unitPrice')}
                            onChange={(v) => edits.setCell(line.id, 'unitPrice', v)}
                            onBlur={() => writes.onCellBlur(line, 'unitPrice')}
                            onKeyDown={(e) => onKeyDown(e, line, 'unitPrice')}
                            col="unitPrice"
                            label={t('col.rate')}
                            mono
                            numeric
                          />
                        ) : (
                          <span
                            className="block whitespace-nowrap p-3 text-end font-mono tabular-nums"
                            dir="ltr"
                          >
                            {money(line.unitPrice)}
                          </span>
                        )}
                      </Td>
                      <Td num>
                        <span
                          className="block whitespace-nowrap p-3 text-end font-mono font-semibold tabular-nums text-[color:var(--text)]"
                          dir="ltr"
                        >
                          {money(edits.amountOf(line))}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex justify-center p-3">
                          {canEdit ? (
                            <button
                              type="button"
                              aria-pressed={line.provisional}
                              aria-label={t('provisional')}
                              title={t('provisional')}
                              disabled={writes.pending}
                              onClick={() =>
                                writes.saveLine(line, { provisional: !line.provisional }, [])
                              }
                              className="inline-flex size-6 items-center justify-center rounded-[8px] border font-mono text-[10px] font-bold"
                              style={
                                line.provisional
                                  ? {
                                      borderColor: 'var(--warn)',
                                      background: 'var(--warn-tint)',
                                      color: 'var(--warn)',
                                    }
                                  : {
                                      borderColor: 'var(--rule)',
                                      color: 'var(--text-faint)',
                                    }
                              }
                            >
                              P
                            </button>
                          ) : (
                            line.provisional && (
                              <span
                                className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                                style={{
                                  background: 'var(--warn-tint)',
                                  color: 'var(--warn)',
                                }}
                              >
                                {t('provisional')}
                              </span>
                            )
                          )}
                        </div>
                      </Td>
                      {canEdit && (
                        <Td>
                          <div className="flex justify-center p-3">
                            {edits.isSaving(line.id) ? (
                              <Loader2
                                className="size-4 animate-spin text-[color:var(--text-faint)]"
                                aria-label={t('saving')}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => writes.onDeleteLine(line.id)}
                                disabled={writes.pending}
                                aria-label={t('deleteLine')}
                                title={t('deleteLine')}
                                className="rounded-[8px] p-1 text-[color:var(--text-faint)] hover:text-[color:var(--danger)]"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            )}
                          </div>
                        </Td>
                      )}
                    </tr>
                  ))}

                {canEdit && !isCollapsed && needle === '' && (
                  <tr>
                    <td colSpan={colCount} className="p-2 ps-4">
                      <button
                        type="button"
                        onClick={() => writes.onAddLine(section.id)}
                        disabled={writes.pending}
                        className="inline-flex items-center gap-2 rounded-pill border border-dashed border-[color:var(--rule)] px-4 py-2 text-[13px] font-semibold text-[color:var(--brand-ink)] hover:border-[color:hsl(var(--brand))] hover:bg-[color:var(--brand-tint)]"
                      >
                        <Plus className="size-3.5" aria-hidden />
                        {t('addLine')}
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}

          {/* Totals are ROWS OF THIS TABLE. The grand total cannot drift out of
              the Amount column because it is in it. */}
          <tfoot>
            <FootRow
              label={t('subtotal')}
              value={money(boq.subtotal)}
              colCount={colCount}
              tinted
            />
            {canEdit ? (
              <FootRow
                label={t('discount')}
                value={money(boq.discountAmount)}
                colCount={colCount}
                tinted
                editor={
                  <>
                    <input
                      value={edits.discount ?? trimNumber(boq.discountPct)}
                      onChange={(e) => edits.setDiscount(e.target.value)}
                      onBlur={(e) => writes.onDiscountBlur(e.target.value.trim())}
                      aria-label={t('discountPct')}
                      dir="ltr"
                      inputMode="decimal"
                      className="w-12 rounded-[8px] border border-transparent bg-transparent p-1 text-end font-mono text-sm tabular-nums text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))]"
                    />
                    <span aria-hidden="true">%</span>
                  </>
                }
              />
            ) : (
              boq.discountAmount !== '0' &&
              boq.discountAmount !== '0.0000' && (
                <FootRow
                  label={t('discount')}
                  value={money(boq.discountAmount)}
                  colCount={colCount}
                  tinted
                />
              )
            )}
            <FootRow
              label={t('total')}
              value={money(boq.total)}
              colCount={colCount}
              grand
            />
          </tfoot>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--rule)] p-3 text-[13px]">
          <button
            type="button"
            onClick={writes.onAddSection}
            disabled={writes.pending}
            className="inline-flex items-center gap-2 rounded-pill border border-dashed border-[color:var(--rule)] px-4 py-2 text-[13px] font-semibold text-[color:var(--brand-ink)] hover:border-[color:hsl(var(--brand))] hover:bg-[color:var(--brand-tint)]"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('addSection')}
          </button>
          <span
            className="inline-flex items-center gap-2 font-semibold"
            style={{ color: edits.savingCount > 0 ? 'var(--text-muted)' : 'var(--success)' }}
          >
            <span
              className="size-2 rounded-full"
              style={{
                background: edits.savingCount > 0 ? 'var(--text-faint)' : 'var(--success)',
              }}
            />
            {edits.savingCount > 0 ? t('saving') : t('allSaved')}
          </span>
          <span className="ms-auto text-xs text-[color:var(--text-faint)]">
            {t('keyboardHint')}
          </span>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  num,
  sticky,
}: {
  children: ReactNode;
  num?: boolean;
  sticky?: 'a' | 'b';
}) {
  return (
    <th
      scope="col"
      className={`sticky top-0 whitespace-nowrap bg-[color:var(--thead)] p-3 font-mono text-[11px] font-bold uppercase tracking-[0.09em] text-[color:var(--thead-ink)] ${num ? 'text-end' : 'text-start'}`}
      style={{
        zIndex: sticky ? 4 : 3,
        borderBottom: '1px solid var(--thead-rule)',
        ...(sticky
          ? { position: 'sticky', insetInlineStart: sticky === 'a' ? 0 : 72 }
          : {}),
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  num,
  sticky,
  dirty,
}: {
  children: ReactNode;
  num?: boolean;
  sticky?: 'a' | 'b';
  /** An unsaved row gets an edge. Autosave with no unsaved marker is a lie. */
  dirty?: boolean;
}) {
  return (
    <td
      className={`bg-card align-middle ${num ? 'text-end' : ''}`}
      style={{
        ...(sticky
          ? {
              position: 'sticky',
              insetInlineStart: sticky === 'a' ? 0 : 72,
              zIndex: 1,
            }
          : {}),
        ...(dirty ? { boxShadow: 'inset 3px 0 0 var(--warn)' } : {}),
      }}
    >
      {children}
    </td>
  );
}

function Cell({
  value,
  onChange,
  onBlur,
  onKeyDown,
  col,
  label,
  mono,
  numeric,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  col: Column;
  label: string;
  mono?: boolean;
  numeric?: boolean;
}) {
  return (
    <input
      value={value}
      data-col={col}
      aria-label={label}
      dir={numeric ? 'ltr' : 'auto'}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className={`w-full rounded-[8px] border border-transparent bg-transparent p-3 text-sm text-[color:var(--text)] outline-none hover:bg-[color:var(--track)] focus:border-[color:hsl(var(--brand))] focus:bg-[color:var(--field-bg)] ${mono ? 'font-mono tabular-nums' : ''} ${numeric ? 'text-end' : ''}`}
    />
  );
}

function FootRow({
  label,
  value,
  colCount,
  tinted,
  grand,
  editor,
}: {
  label: string;
  value: string;
  colCount: number;
  tinted?: boolean;
  grand?: boolean;
  /** Rendered beside the label — the discount PERCENTAGE, where the amount it
   *  produces still lands in the Amount column with everything else. */
  editor?: ReactNode;
}) {
  // ONLY the grand total pins. Sticking all three rows at bottom:0 stacks them
  // on top of each other — the first render of this sheet showed TOTAL sitting
  // on top of Subtotal and Discount, hiding both. The grand total is the figure
  // you steer by; the two above it are reference and can scroll into view with
  // the end of the sheet.
  const cell: CSSProperties = {
    ...(grand ? { position: 'sticky', insetBlockEnd: 0, zIndex: 3 } : {}),
    background: tinted ? 'var(--track)' : 'hsl(var(--card))',
    borderTop: grand ? '2px solid var(--rule)' : '1px solid var(--rule-soft)',
  };
  return (
    <tr>
      <td
        colSpan={5}
        style={cell}
        className={`p-3 font-mono text-[11px] font-bold uppercase tracking-[0.09em] ${grand ? 'text-[color:var(--text)]' : 'text-[color:var(--text-faint)]'}`}
      >
        {/* Pinned inside its spanning cell for the same reason as the section
            title — a totals row whose label has scrolled away is a bare number. */}
        <span
          className="inline-flex w-fit items-center gap-2"
          style={{ position: 'sticky', insetInlineStart: 0 }}
        >
          {label}
          {editor}
        </span>
      </td>
      <td
        style={cell}
        dir="ltr"
        className={`whitespace-nowrap p-3 text-end font-mono font-bold tabular-nums text-[color:var(--text)] ${grand ? 'text-[18px]' : 'text-sm'}`}
      >
        {value}
      </td>
      <td colSpan={colCount - 6} style={cell} />
    </tr>
  );
}
