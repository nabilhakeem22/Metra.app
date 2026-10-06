'use client';

// Adapted from the shadcn/ui toast hook: a small module-level store + reducer
// with a stable `toast()` API. No external state library.
import * as React from 'react';
import type {
  ToastActionElement,
  ToastProps,
} from '@/components/ui/toast';

const TOAST_LIMIT = 4;
const TOAST_REMOVE_DELAY = 5000;

type ToasterToast = Omit<ToastProps, 'title'> & {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
};

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToasterToast> }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string };

interface State {
  toasts: ToasterToast[];
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

function reducer(state: State, action: Action): State {
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

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

// `onClose` handlers, kept OUT of the store (the store is spread onto the
// Radix Toast as props). Each fires exactly once, when its toast leaves.
const closeHandlers = new Map<string, () => void>();

function settleClose(toastId: string): void {
  const onClose = closeHandlers.get(toastId);
  if (!onClose) return;
  closeHandlers.delete(toastId);
  onClose();
}

function dispatch(action: Action) {
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
  return memoryState.toasts.find(
    (shown) =>
      shown.open &&
      !shown.action &&
      !closeHandlers.has(shown.id) &&
      shown.variant === input.variant &&
      shown.title === input.title &&
      shown.description === input.description,
  );
}

export function toast(input: ToastInput) {
  const twin = openTwinOf(input);
  if (twin) return handleFor(twin.id);

  const { onClose, ...props } = input;
  const id = genId();
  if (onClose) closeHandlers.set(id, onClose);
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
  const [state, setState] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const i = listeners.indexOf(setState);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }),
  };
}
