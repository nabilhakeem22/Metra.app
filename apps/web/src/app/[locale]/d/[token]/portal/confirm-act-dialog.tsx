'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useReturnFocus } from './use-return-focus';

/**
 * "Are you sure?" before a client act that cannot be taken back from this page:
 * approving the concept or the design, confirming the handover, saying a
 * payment was made, and signing the contract. Cancel (or Escape, or a tap outside) only closes it: it
 * calls nothing. Confirm calls `onConfirm` once and shows `pending` until the
 * caller closes the dialog; `confirmDisabled` holds it until the act can be
 * sent (an act that needs a one-time code, before the code is typed), and
 * `confirmShown` false leaves it out when the act cannot be sent from here at
 * all (no address on file for the code: H5 weak spot 5). Both buttons are at
 * least 44 px tall. It is never taller than the screen: on a phone with the
 * keyboard open it scrolls, so Confirm stays reachable. Closing returns focus
 * to the button that opened it.
 */
export function ConfirmActDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending,
  confirmDisabled = false,
  confirmShown = true,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pending: boolean;
  confirmDisabled?: boolean;
  confirmShown?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          {...returnFocus}
          className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[calc(100dvh-2rem)] max-w-sm -translate-y-1/2 overflow-y-auto rounded-panel border bg-card p-5 text-start shadow-card outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none">
          <DialogPrimitive.Title className="text-title font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <div className="mt-2 space-y-2 text-body text-muted-foreground">{body}</div>
          </DialogPrimitive.Description>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="min-h-11"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            {confirmShown && (
              <Button variant="default" className="min-h-11" disabled={pending || confirmDisabled} onClick={onConfirm}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {confirmLabel}
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
