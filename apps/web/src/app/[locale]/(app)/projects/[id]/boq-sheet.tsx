'use client';

import { ChevronDown, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useMemo, useRef, useState, useTransition } from 'react';
import { toast } from '@/hooks/use-toast';
import { computeLine } from '@/lib/aggregates/proposal-totals';
import {
  addBoqLine,
  addBoqSection,
  deleteBoqLine,
  setBoqDiscount,
  updateBoqLine,
} from '@/lib/boqs/actions';
import { BOQ_UNITS, type BoqLinePatch } from '@/lib/boqs/edit-input';
import type { BoqDetail, BoqLineRow } from '@/lib/boqs/queries';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';

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

/** Trim a stored scale-4 figure to something worth typing over: 8.5000 -> 8.5 */
function trimNumber(v: string): string {
  if (!v.includes('.')) return v;
  const t = v.replace(/0+$/, '').replace(/\.$/, '');
  return t === '' || t === '-' ? '0' : t;
}

interface EditableLine extends BoqLineRow {
  sectionId: string;
}

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
  const [pending, start] = useTransition();

  // Local edits, keyed lineId -> column -> what the studio typed. Cleared on a
  // successful save, after which the revalidated props are the truth again.
  // Overriding rather than mirroring means a save landing from another tab is
  // not fought over: only the cells actually being typed in are held locally.
  const [edits, setEdits] = useState<Record<string, Partial<Record<Column, string>>>>({});
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  /** Local edit of the document discount, same override rule as a cell. */
  const [discount, setDiscount] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  const money = (v: string) => formatMoney(v, locale);

  /** Server refusals the sheet can name precisely. Anything else is generic. */
  function refusal(error?: string): string {
    switch (error) {
      case 'invalid_qty':
        return t('errQty');
      case 'invalid_price':
        return t('errPrice');
      case 'description_required':
        return t('errDescription');
      case 'boq_not_draft':
        return t('errFrozen');
      case 'too_many_lines':
        return t('errTooMany');
      case 'invalid_discount':
        return t('errDiscount');
      case 'name_required':
        return t('errSectionName');
      case 'forbidden':
        return t('errForbidden');
      default:
        return t('saveFailed');
    }
  }

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

  /** What a cell should show: the local edit if there is one, else the record. */
  function cellValue(line: EditableLine, col: Column): string {
    const edit = edits[line.id]?.[col];
    if (edit !== undefined) return edit;
    switch (col) {
      case 'itemCode':
        return line.itemCode ?? '';
      case 'description':
        return line.description;
      case 'qty':
        return trimNumber(line.qty);
      case 'unitPrice':
        return trimNumber(line.unitPrice);
      case 'unit':
        return line.unit;
    }
  }

  /**
   * The amount as it will be stored, recomputed from what is on screen.
   *
   * It runs the SAME `computeLine` the server runs, so the number the studio is
   * steering by while typing is the number that lands in the row — rather than a
   * browser-side approximation that disagrees with the document by a piastre.
   */
  function amountOf(line: EditableLine): string {
    const qty = edits[line.id]?.qty;
    const price = edits[line.id]?.unitPrice;
    if (qty === undefined && price === undefined) return line.lineTotal;
    return computeLine({
      qty: qty ?? line.qty,
      unitPrice: price ?? line.unitPrice,
      unitCost: '0',
      discountPct: line.discountPct,
    }).lineTotal;
  }

  function markSaving(id: string, on: boolean): void {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Commit one line. Called on blur, and only when something actually changed. */
  function saveLine(line: EditableLine, patch: BoqLinePatch, cols: Column[]): void {
    markSaving(line.id, true);
    start(async () => {
      try {
        const res = await updateBoqLine({ lineId: line.id, patch });
        if (res.ok) {
          // Drop the local edit so the revalidated record takes over. Anything
          // still being typed in another cell of the same row is untouched.
          setEdits((prev) => {
            const row = { ...(prev[line.id] ?? {}) };
            for (const c of cols) delete row[c];
            const next = { ...prev };
            if (Object.keys(row).length === 0) delete next[line.id];
            else next[line.id] = row;
            return next;
          });
        } else {
          // The edit STAYS on screen when the server refuses it. Reverting to
          // the stored value would throw away what the studio typed and leave
          // them guessing which cell was wrong.
          toast({ title: refusal(res.error), variant: 'destructive' });
        }
      } catch {
        toast({ title: t('saveFailed'), variant: 'destructive' });
      } finally {
        markSaving(line.id, false);
      }
    });
  }

  function onCellBlur(line: EditableLine, col: Column): void {
    const typed = edits[line.id]?.[col];
    if (typed === undefined) return;
    if (typed === cellValueFromRecord(line, col)) {
      // Focused, changed nothing (or typed it back). No write.
      setEdits((prev) => {
        const row = { ...(prev[line.id] ?? {}) };
        delete row[col];
        const next = { ...prev };
        if (Object.keys(row).length === 0) delete next[line.id];
        else next[line.id] = row;
        return next;
      });
      return;
    }
    saveLine(line, { [col]: typed } as BoqLinePatch, [col]);
  }

  function setCell(id: string, col: Column, value: string): void {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [col]: value } }));
  }

  /**
   * Enter walks DOWN the column, which is how a rate list is actually typed.
   * Tab still moves across. Escape puts the cell back and writes nothing.
   */
  function onKeyDown(e: KeyboardEvent<HTMLElement>, line: EditableLine, col: Column): void {
    if (e.key === 'Escape') {
      setEdits((prev) => {
        const row = { ...(prev[line.id] ?? {}) };
        delete row[col];
        const next = { ...prev };
        if (Object.keys(row).length === 0) delete next[line.id];
        else next[line.id] = row;
        return next;
      });
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const cells = gridRef.current?.querySelectorAll<HTMLElement>(
      `[data-col="${col}"]`,
    );
    if (!cells) return;
    const list = [...cells];
    const here = list.indexOf(e.currentTarget);
    const next = list[here + 1];
    next?.focus();
  }

  function toggleSection(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onAddLine(sectionId: string): void {
    start(async () => {
      const res = await addBoqLine({ sectionId, description: t('newLine') });
      if (!res.ok) toast({ title: refusal(res.error), variant: 'destructive' });
    });
  }

  function onAddSection(): void {
    start(async () => {
      const res = await addBoqSection({ boqId: boq.id, title: t('newSection') });
      if (!res.ok) toast({ title: refusal(res.error), variant: 'destructive' });
    });
  }

  function onDiscountBlur(typed: string): void {
    if (typed === trimNumber(boq.discountPct)) return;
    start(async () => {
      const res = await setBoqDiscount({ boqId: boq.id, discountPct: typed });
      if (res.ok) setDiscount(null);
      else toast({ title: refusal(res.error), variant: 'destructive' });
    });
  }

  function onDeleteLine(lineId: string): void {
    start(async () => {
      const res = await deleteBoqLine({ lineId });
      if (!res.ok) toast({ title: refusal(res.error), variant: 'destructive' });
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
                      <Td sticky="a" dirty={edits[line.id] !== undefined}>
                        {canEdit ? (
                          <Cell
                            value={cellValue(line, 'itemCode')}
                            onChange={(v) => setCell(line.id, 'itemCode', v)}
                            onBlur={() => onCellBlur(line, 'itemCode')}
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
                            value={cellValue(line, 'description')}
                            onChange={(v) => setCell(line.id, 'description', v)}
                            onBlur={() => onCellBlur(line, 'description')}
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
                            value={cellValue(line, 'unit')}
                            data-col="unit"
                            aria-label={t('col.unit')}
                            onChange={(e) => {
                              setCell(line.id, 'unit', e.target.value);
                              saveLine(line, { unit: e.target.value }, ['unit']);
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
                            value={cellValue(line, 'qty')}
                            onChange={(v) => setCell(line.id, 'qty', v)}
                            onBlur={() => onCellBlur(line, 'qty')}
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
                            value={cellValue(line, 'unitPrice')}
                            onChange={(v) => setCell(line.id, 'unitPrice', v)}
                            onBlur={() => onCellBlur(line, 'unitPrice')}
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
                          {money(amountOf(line))}
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
                              disabled={pending}
                              onClick={() =>
                                saveLine(line, { provisional: !line.provisional }, [])
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
                            {savingIds.has(line.id) ? (
                              <Loader2
                                className="size-4 animate-spin text-[color:var(--text-faint)]"
                                aria-label={t('saving')}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => onDeleteLine(line.id)}
                                disabled={pending}
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
                        onClick={() => onAddLine(section.id)}
                        disabled={pending}
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
                      value={discount ?? trimNumber(boq.discountPct)}
                      onChange={(e) => setDiscount(e.target.value)}
                      onBlur={(e) => onDiscountBlur(e.target.value.trim())}
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
            onClick={onAddSection}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-pill border border-dashed border-[color:var(--rule)] px-4 py-2 text-[13px] font-semibold text-[color:var(--brand-ink)] hover:border-[color:hsl(var(--brand))] hover:bg-[color:var(--brand-tint)]"
          >
            <Plus className="size-3.5" aria-hidden />
            {t('addSection')}
          </button>
          <span
            className="inline-flex items-center gap-2 font-semibold"
            style={{ color: savingIds.size > 0 ? 'var(--text-muted)' : 'var(--success)' }}
          >
            <span
              className="size-2 rounded-full"
              style={{
                background: savingIds.size > 0 ? 'var(--text-faint)' : 'var(--success)',
              }}
            />
            {savingIds.size > 0 ? t('saving') : t('allSaved')}
          </span>
          <span className="ms-auto text-xs text-[color:var(--text-faint)]">
            {t('keyboardHint')}
          </span>
        </div>
      )}
    </div>
  );
}

type Column = 'itemCode' | 'description' | 'unit' | 'qty' | 'unitPrice';

function cellValueFromRecord(line: EditableLine, col: Column): string {
  switch (col) {
    case 'itemCode':
      return line.itemCode ?? '';
    case 'description':
      return line.description;
    case 'qty':
      return trimNumber(line.qty);
    case 'unitPrice':
      return trimNumber(line.unitPrice);
    case 'unit':
      return line.unit;
  }
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
