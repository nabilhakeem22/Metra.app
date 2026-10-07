'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { resolveActionError } from '@/lib/actions/error-message';
import { DeliveryReminderReady } from './delivery-reminder-ready';
import { DELIVERY_REMINDER_OPEN_EVENT } from './share-anchor';
import { useDeliveryReminder, type DeliveryReminderApi } from './use-delivery-reminder';

/**
 * "Send reminder" (Round B, B11): remind the client on WhatsApp, or by email,
 * with the link they ALREADY hold. Owner/admin only (the caller renders it only
 * with `canShare`; the server actions enforce it). Opens from the header menu,
 * the waiting card and the checklist's nudge pill (`openDeliveryReminder()`).
 * Opening it never rotates the link; a link that cannot be re-created is
 * replaced only through the confirmation below.
 */
export function DeliveryReminderDialog({ engagementId }: { engagementId: string }) {
  const t = useTranslations('engagements.reminder');
  const tc = useTranslations('common');
  const api = useDeliveryReminder(engagementId);
  const { setOpen } = api;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(DELIVERY_REMINDER_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DELIVERY_REMINDER_OPEN_EVENT, onOpen);
  }, [setOpen]);

  return (
    <DialogPrimitive.Root open={api.open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-h-[90vh] max-w-md -translate-y-1/2 overflow-y-auto rounded-panel border bg-card p-4 text-start shadow-card outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none">
          <div className="flex items-center gap-2 pb-2">
            <DialogPrimitive.Title className="text-title font-semibold">{t('title')}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton type="button" aria-label={tc('close')} className="ms-auto">
                <X className="size-4" aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="pb-3 text-small text-[color:var(--text-muted)]">
            {t('intro')}
          </DialogPrimitive.Description>
          <ReminderBody api={api} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ReminderBody({ api }: { api: DeliveryReminderApi }) {
  const t = useTranslations('engagements.reminder');
  const terrors = useTranslations('errors');
  const { view } = api;
  if (view.status === 'ready') return <DeliveryReminderReady api={api} reminder={view.reminder} />;
  if (view.status === 'unrecoverable') return <ReplaceLink api={api} />;
  if (view.status === 'failed') {
    return (
      <p className="text-body text-destructive" role="alert">
        {resolveActionError(view.error, terrors)}
      </p>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-small text-[color:var(--text-muted)]">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t('loading')}
    </p>
  );
}

/** The link cannot be re-created: explain why, and offer ONE replacement, behind a confirm. */
function ReplaceLink({ api }: { api: DeliveryReminderApi }) {
  const t = useTranslations('engagements.reminder');
  const tc = useTranslations('common');
  const { confirm, dialog } = useConfirm();

  async function confirmReplace(): Promise<void> {
    const confirmed = await confirm({
      title: t('confirmReplace.title'),
      description: `${t('confirmReplace.body')} ${tc('cannotUndo')}`,
      confirmLabel: t('replace'),
      cancelLabel: tc('cancel'),
      variant: 'destructive',
    });
    if (confirmed) api.replaceAndReload();
  }

  return (
    <div className="space-y-3">
      {dialog}
      <p className="text-body font-semibold">{t('unrecoverableTitle')}</p>
      <p className="text-small text-[color:var(--text-muted)]">{t('unrecoverableBody')}</p>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={api.replacing}
        onClick={() => void confirmReplace()}
      >
        {api.replacing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        {t('replace')}
      </Button>
    </div>
  );
}
