'use client';

import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';

/**
 * How long an Undo toast stays when nobody touches it. Radix PAUSES this while
 * the pointer is over the toast, while it has focus and while the window is
 * blurred, which is exactly when somebody is reaching for Undo. That is why a
 * deferred delete never runs on its own timer: it runs when this toast closes.
 */
const UNDO_WINDOW_MS = 5000;

/**
 * The longest an Undo toast may stay, paused or not. Radix pauses its timer for
 * as long as the toast is hovered, focused or the window is blurred, so without
 * a cap a parked pointer would keep a delete pending for ever.
 */
export const UNDO_HARD_CAP_MS = 30_000;

export interface UndoToastHandle {
  /** Close the toast now. Its `onExpire` runs unless Undo was pressed. */
  dismiss: () => void;
}

/**
 * A toast that says what just happened and offers to take it back.
 *
 * `onExpire` is the toast's single clock: it runs once when the toast leaves for
 * any reason OTHER than Undo (its timer, the UNDO_HARD_CAP_MS cap, its close
 * button, a swipe, Escape, `dismiss()`, or eviction by the toast limit). Once it has run the toast is
 * gone, so Undo can never be pressed after the thing it would undo has started.
 */
export function showUndoToast(options: {
  title: string;
  undoLabel: string;
  onUndo: () => void;
  onExpire?: () => void;
}): UndoToastHandle {
  let undone = false;
  const { dismiss } = toast({
    title: options.title,
    duration: UNDO_WINDOW_MS,
    action: (
      <ToastAction
        altText={options.undoLabel}
        onClick={() => {
          // Runs BEFORE the action closes the toast, so the close below knows.
          undone = true;
          options.onUndo();
        }}
      >
        {options.undoLabel}
      </ToastAction>
    ),
    onClose: () => {
      clearTimeout(hardCap);
      if (!undone) options.onExpire?.();
    },
  });
  // Read by onClose, which can only run after this line: a toast never closes
  // inside the call that shows it.
  const hardCap = setTimeout(dismiss, UNDO_HARD_CAP_MS);
  return { dismiss };
}
