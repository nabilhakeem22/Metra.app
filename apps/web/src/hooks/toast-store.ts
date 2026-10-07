// The toast STORE: module-level state, its reducer, and who hears a change.
// Adapted from the shadcn/ui toast hook; no external state library. The public
// API (`toast()`, `useToast()`) lives in ./use-toast.ts and is the only module
// that should reach in here.
import type * as React from 'react';
import type { ToastActionElement, ToastProps } from '@/components/ui/toast';

const TOAST_LIMIT = 4;
const TOAST_REMOVE_DELAY = 5000;

export type ToasterToast = Omit<ToastProps, 'title'> & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToasterToast> }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string };

export interface ToastState {
  toasts: ToasterToast[];
}

let count = 0;
export function genToastId(): string {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function addToRemoveQueue(toastId: string) {
  if (toastTimeouts.has(toastId)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({ type: 'REMOVE_TOAST', toastId });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(toastId, timeout);
}

function reducer(state: ToastState, action: Action): ToastState {
  switch (action.type) {
    case 'ADD_TOAST':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'UPDATE_TOAST':
      return {
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t,
        ),
      };
    case 'DISMISS_TOAST': {
      const { toastId } = action;
      if (toastId) addToRemoveQueue(toastId);
      else state.toasts.forEach((t) => addToRemoveQueue(t.id));
      return {
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? { ...t, open: false }
            : t,
        ),
      };
    }
    case 'REMOVE_TOAST':
      if (action.toastId === undefined) return { toasts: [] };
      return { toasts: state.toasts.filter((t) => t.id !== action.toastId) };
    default:
      return state;
  }
}

const listeners: Array<(state: ToastState) => void> = [];
let memoryState: ToastState = { toasts: [] };

/** The store as it stands now. */
export function currentToastState(): ToastState {
  return memoryState;
}

/** Hear every change; the returned function stops listening. */
export function subscribeToToasts(listener: (state: ToastState) => void): () => void {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i > -1) listeners.splice(i, 1);
  };
}

// `onClose` handlers, kept OUT of the store (the store is spread onto the
// Radix Toast as props). Each fires exactly once, when its toast leaves.
const closeHandlers = new Map<string, () => void>();

export function registerCloseHandler(toastId: string, onClose: () => void): void {
  closeHandlers.set(toastId, onClose);
}

export function hasCloseHandler(toastId: string): boolean {
  return closeHandlers.has(toastId);
}

function settleClose(toastId: string): void {
  const onClose = closeHandlers.get(toastId);
  if (!onClose) return;
  closeHandlers.delete(toastId);
  onClose();
}

export function dispatch(action: Action) {
  const before = memoryState.toasts;
  memoryState = reducer(memoryState, action);
  listeners.forEach((l) => l(memoryState));
  // A toast has left when it is dismissed (timeout, close button, its action,
  // swipe, Escape, dismiss()) or when it drops out of the list (removed, or
  // evicted by TOAST_LIMIT). Either way its owner hears about it, once.
  if (action.type === 'DISMISS_TOAST') {
    for (const t of before) if (action.toastId === undefined || t.id === action.toastId) settleClose(t.id);
  }
  for (const t of before) {
    if (!memoryState.toasts.some((kept) => kept.id === t.id)) settleClose(t.id);
  }
}
