'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'default' | 'destructive';
}

/**
 * Imperative confirm. `confirm(opts)` returns a promise that resolves true on
 * confirm, false on cancel/dismiss. Render the returned `dialog` node once.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpen(false);
  }, []);

  const dialog = (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <AlertDialog.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-2xl border bg-card p-6 text-start shadow-card outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none">
        {opts && (
          <>
            <AlertDialog.Title className="text-lg font-semibold">
              {opts.title}
            </AlertDialog.Title>
            {opts.description && (
              <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">
                {opts.description}
              </AlertDialog.Description>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" onClick={() => settle(false)}>
                  {opts.cancelLabel}
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button
                  variant={
                    opts.variant === 'destructive' ? 'destructive' : 'default'
                  }
                  onClick={() => settle(true)}
                >
                  {opts.confirmLabel}
                </Button>
              </AlertDialog.Action>
            </div>
          </>
        )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return { confirm, dialog };
}
