'use client';

import { toast } from '@/hooks/use-toast';
import type { TransitionStartFunction } from 'react';
import {
  addBoqLine,
  addBoqSection,
  deleteBoqLine,
  setBoqDiscount,
  updateBoqLine,
} from '@/lib/boqs/actions';
import type { BoqLinePatch } from '@/lib/boqs/edit-input';
import type { BoqDetail } from '@/lib/boqs/queries';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  recordValue,
  trimNumber,
  type Column,
  type EditableLine,
  type RowEdits,
} from './boq-sheet-columns';
import type { CellWriteLatch } from './cell-write-latch';
import type { BoqEditsApi } from './use-boq-edits';

/**
 * WHAT EACH WRITE ON THE BOQ SHEET DOES, and what it toasts. Plain functions over
 * an explicit context — use-boq-writes.ts is the hook that binds them to React.
 *
 * SAVE IS PER LINE, ON BLUR. Not per keystroke — a half-typed rate ("15" on the
 * way to "1500") must never be written to a document a client will sign.
 *
 * Coded server refusals resolve through the SHARED errors catalogue. This screen
 * used to map eight of them by hand and send everything else to "That change was
 * not saved", which is what an over-length description or a vanished line looked
 * like to the studio.
 */
export interface WriteContext {
  boq: BoqDetail;
  edits: BoqEditsApi;
  start: TransitionStartFunction;
  /** Orders two saves of the SAME cell — see cell-write-latch.ts. */
  latch: CellWriteLatch;
  sheetText: (key: string) => string;
  errorText: (key: string) => string;
}

function refuse(context: WriteContext, code: ActionCode | undefined): void {
  toast({
    title: resolveActionError(code, context.errorText),
    variant: 'destructive',
  });
}

/** What this write carries for the cells it names, to compare against later. */
function savedValues(patch: BoqLinePatch, columns: Column[]): RowEdits {
  const saved: RowEdits = {};
  for (const column of columns) {
    const value = patch[column];
    if (typeof value === 'string') saved[column] = value;
  }
  return saved;
}

/**
 * Commit one line. Called on blur, and only when something actually changed.
 *
 * THE CELL IS LATCHED, so a second save of the same cell WAITS for the first
 * rather than racing it, and a THIRD supersedes the second rather than queueing
 * behind it — the whole reason is in cell-write-latch.ts. The row is marked saving
 * SYNCHRONOUSLY, before anything is queued, so a write that is merely waiting its
 * turn still shows as unsaved; `markSaving` counts, so the first write finishing
 * does not report "all saved" over a second still in flight. The unmark hangs off
 * the LATCH's promise rather than the request's, because a superseded write never
 * runs and its row would otherwise stay marked saving forever.
 */
export function saveLine(
  context: WriteContext,
  line: EditableLine,
  patch: BoqLinePatch,
  columns: Column[],
): void {
  context.edits.markSaving(line.id, true);
  const saved = savedValues(patch, columns);
  context.start(() =>
    context.latch
      .run({
        lineId: line.id,
        columns,
        write: async () => {
          try {
            const result = await updateBoqLine({ lineId: line.id, patch });
            // Drop the local edit so the revalidated record takes over — but only
            // for cells that still hold the value this write carried. One the
            // studio has re-typed keeps its override until its own write lands.
            if (result.ok) context.edits.clearSaved(line.id, saved);
            // The edit STAYS on screen when the server refuses it. Reverting to
            // the stored value would throw away what the studio typed and leave
            // them guessing which cell was wrong.
            else refuse(context, result.error);
          } catch (cause) {
            // A REJECTION LEAVES NO TRACE ANYWHERE ELSE: `mutateInOrg` never saw
            // it, so the server has nothing, and the toast below is gone in five
            // seconds. Logged the way use-engagement-action.ts logs its twin, so
            // `wrangler tail` carries a failed BOQ save at all.
            console.error('boq line save failed before returning a result', cause);
            toast({ title: context.sheetText('saveFailed'), variant: 'destructive' });
          }
        },
        onDeadline: () => {
          // The request never answered. The latch has already given the cell
          // back; this is the only thing that tells anybody it happened.
          console.error('boq line save passed its deadline with no answer', {
            lineId: line.id,
            columns,
          });
          toast({ title: context.sheetText('saveFailed'), variant: 'destructive' });
        },
      })
      .finally(() => {
        context.edits.markSaving(line.id, false);
      }),
  );
}

export function cellBlur(
  context: WriteContext,
  line: EditableLine,
  column: Column,
): void {
  const typed = context.edits.cells[line.id]?.[column];
  if (typed === undefined) return;
  if (typed === recordValue(line, column)) {
    // Focused, changed nothing (or typed it back). No write.
    context.edits.clearColumns(line.id, [column]);
    return;
  }
  saveLine(context, line, { [column]: typed } as BoqLinePatch, [column]);
}

export function addLine(context: WriteContext, sectionId: string): void {
  context.start(async () => {
    const result = await addBoqLine({
      sectionId,
      description: context.sheetText('newLine'),
    });
    if (!result.ok) refuse(context, result.error);
  });
}

export function addSection(context: WriteContext): void {
  context.start(async () => {
    const result = await addBoqSection({
      boqId: context.boq.id,
      title: context.sheetText('newSection'),
    });
    if (!result.ok) refuse(context, result.error);
  });
}

export function discountBlur(context: WriteContext, typed: string): void {
  if (typed === trimNumber(context.boq.discountPct)) {
    // Focused, changed nothing (or typed it back). No write — and the local
    // override has done its job, so it goes, exactly as an unchanged cell's
    // does. Leaving it behind pinned a percentage on screen that the discount
    // and total beside it then contradicted, the moment anybody else changed
    // the document discount under the open sheet.
    context.edits.setDiscount(null);
    return;
  }
  context.start(async () => {
    const result = await setBoqDiscount({
      boqId: context.boq.id,
      discountPct: typed,
    });
    if (result.ok) context.edits.setDiscount(null);
    else refuse(context, result.error);
  });
}

export function deleteLine(context: WriteContext, lineId: string): void {
  context.start(async () => {
    const result = await deleteBoqLine({ lineId });
    if (!result.ok) refuse(context, result.error);
  });
}
