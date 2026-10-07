'use client';

// The toast API: `toast()` raises one, `useToast()` reads the list (the
// Toaster). The store it drives is ./toast-store.ts.
import * as React from 'react';
import type { ToastActionElement, ToastProps } from '@/components/ui/toast';
import {
  currentToastState,
  dispatch,
  genToastId,
  hasCloseHandler,
  registerCloseHandler,
  subscribeToToasts,
  type ToasterToast,
  type ToastState,
} from './toast-store';

export interface ToastInput {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastProps['variant'];
  action?: ToastActionElement;
  duration?: number;
  type?: ToastProps['type'];
  /**
   * Called once when this toast leaves for ANY reason: its timer, its close
   * button, its action, a swipe or Escape, `dismiss()`, or eviction by the
   * toast limit. A toast whose lifetime IS a clock (the Undo toast) hangs its
   * consequence here, so what is on screen and what happens can never drift.
   */
  onClose?: () => void;
}

/**
 * How a toast speaks to assistive tech and how long it stays, by kind. An
 * ERROR stays until it is dismissed: a refusal that vanishes in five seconds
 * is one a slow reader or a screen-reader user never gets to. Everything else
 * is announced politely (`background`), never interrupting what is being read.
 * A caller's explicit `duration` / `type` still wins.
 */
function defaultsFor(variant: ToastInput['variant']): Pick<ToastInput, 'duration' | 'type'> {
  return variant === 'destructive' ? { duration: Infinity } : { type: 'background' };
}

function handleFor(id: string) {
  const update = (next: Partial<ToasterToast>) =>
    dispatch({ type: 'UPDATE_TOAST', toast: { ...next, id } });
  const dismiss = () => dispatch({ type: 'DISMISS_TOAST', toastId: id });
  return { id, dismiss, update };
}

const isPlainText = (value: React.ReactNode): boolean =>
  value === undefined || typeof value === 'string';

/**
 * The error toast already on screen that says exactly the same thing, if any.
 * An error stays until dismissed, so the same refusal five times would
 * otherwise stack five identical toasts. Only plain-text errors without an
 * action or a close handler collapse: anything carrying behaviour is its own.
 */
function openTwinOf(input: ToastInput): ToasterToast | undefined {
  if (input.variant !== 'destructive' || input.action || input.onClose) return undefined;
  if (!isPlainText(input.title) || !isPlainText(input.description)) return undefined;
  return currentToastState().toasts.find(
    (shown) =>
      shown.open &&
      !shown.action &&
      !hasCloseHandler(shown.id) &&
      shown.variant === input.variant &&
      shown.title === input.title &&
      shown.description === input.description,
  );
}

export function toast(input: ToastInput) {
  const twin = openTwinOf(input);
  if (twin) return handleFor(twin.id);

  const { onClose, ...props } = input;
  const id = genToastId();
  if (onClose) registerCloseHandler(id, onClose);
  const { dismiss, update } = handleFor(id);

  dispatch({
    type: 'ADD_TOAST',
    toast: {
      ...defaultsFor(props.variant),
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  return { id, dismiss, update };
}

export function useToast() {
  const [state, setState] = React.useState<ToastState>(currentToastState);
  React.useEffect(() => subscribeToToasts(setState), []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}
