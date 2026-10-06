'use client';

import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';

/** How long a reversible change offers its Undo, and how long a deferred delete waits. */
export const UNDO_WINDOW_MS = 5000;

/** A toast that says what just happened and offers to take it back. */
export function showUndoToast(options: {
  title: string;
  undoLabel: string;
  onUndo: () => void;
}): void {
  toast({
    title: options.title,
    duration: UNDO_WINDOW_MS,
    action: (
      <ToastAction altText={options.undoLabel} onClick={options.onUndo}>
        {options.undoLabel}
      </ToastAction>
    ),
  });
}
