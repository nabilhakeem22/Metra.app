'use client';

import { useMemo, useRef, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { BoqLinePatch } from '@/lib/boqs/edit-input';
import type { BoqDetail } from '@/lib/boqs/queries';
import type { Column, EditableLine } from './boq-sheet-columns';
import {
  addLine,
  addSection,
  cellBlur,
  deleteLine,
  discountBlur,
  saveLine,
  type WriteContext,
} from './boq-write-actions';
import { createCellWriteLatch } from './cell-write-latch';
import type { BoqEditsApi } from './use-boq-edits';

/**
 * EVERY server write the BOQ sheet makes, bound to React. What each one DOES is
 * in boq-write-actions.ts; this file owns only how they reach it.
 */
export interface BoqWriteHandlers {
  saveLine(line: EditableLine, patch: BoqLinePatch, columns: Column[]): void;
  onCellBlur(line: EditableLine, column: Column): void;
  onAddLine(sectionId: string): void;
  onAddSection(): void;
  onDiscountBlur(typed: string): void;
  onDeleteLine(lineId: string): void;
}

export interface BoqWritesApi extends BoqWriteHandlers {
  pending: boolean;
}

/**
 * Bind the writes to this sheet.
 *
 * THE CONTEXT LIVES IN A REF, read at DISPATCH time rather than closed over at
 * render time. The handlers are created ONCE, so that a row's `React.memo` is not
 * defeated by a fresh closure per render; the ref is what keeps those one-time
 * closures from serving a stale boq, a stale catalogue or a stale edits api. It
 * is assigned during render rather than in an effect, because a blur can fire
 * before the effect of the render that caused it has run, and a save must never
 * carry the previous boq.
 *
 * THE LATCH LIVES IN A REF FOR THE LIFE OF THE SHEET, one per mounted sheet.
 * It has to outlive every render (a per-render latch orders nothing) and must
 * NOT outlive the mount: its keys are line ids, and a second sheet's writes are
 * a different document's.
 */
export function useBoqWrites(options: {
  boq: BoqDetail;
  edits: BoqEditsApi;
}): BoqWritesApi {
  const sheetText = useTranslations('projects.profile.boq');
  const errorText = useTranslations('errors');
  const [pending, start] = useTransition();
  const latch = useRef(createCellWriteLatch()).current;
  const context = useRef<WriteContext>({ ...options, start, latch, sheetText, errorText });
  context.current = { ...options, start, latch, sheetText, errorText };

  const handlers = useMemo<BoqWriteHandlers>(
    () => ({
      saveLine: (line, patch, columns) => saveLine(context.current, line, patch, columns),
      onCellBlur: (line, column) => cellBlur(context.current, line, column),
      onAddLine: (sectionId) => addLine(context.current, sectionId),
      onAddSection: () => addSection(context.current),
      onDiscountBlur: (typed) => discountBlur(context.current, typed),
      onDeleteLine: (lineId) => deleteLine(context.current, lineId),
    }),
    [],
  );

  // `pending` changes identity here on purpose: it is not part of the stable row
  // api, it travels to the rows as its own prop. See boq-sheet-row-api.ts.
  return { pending, ...handlers };
}
