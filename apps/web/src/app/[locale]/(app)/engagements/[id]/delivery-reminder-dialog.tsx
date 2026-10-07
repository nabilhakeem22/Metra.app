'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { resolveActionError } from '@/lib/actions/error-message';
import { DeliveryReminderReady } from './delivery-reminder-ready';
import {
  ReminderNotConfigured,
  ReminderNotShared,
  ReminderReplaceLink,
} from './delivery-reminder-refusals';
import { DELIVERY_REMINDER_OPEN_EVENT } from './share-anchor';
import { useDeliveryReminder, type DeliveryReminderApi } from './use-delivery-reminder';

/**
 * "Send reminder" (Round B, B11): remind the client on WhatsApp, or by email,
 * with the link they ALREADY hold. Owner/admin only (the caller renders it only
 * with `canShare`; the server actions enforce it). Opens from the header menu,
 * the waiting card and the checklist's nudge pill (`openDeliveryReminder()`).
 * Opening it never changes the link (it writes one audit row: the link was
 * shown). A link that cannot be re-created is replaced only through a
 * confirmation; a delivery with no link is offered Share instead.
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
  if (view.status === 'notShared') return <ReminderNotShared api={api} />;
  if (view.status === 'notConfigured') return <ReminderNotConfigured />;
  if (view.status === 'unrecoverable') return <ReminderReplaceLink api={api} />;
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
