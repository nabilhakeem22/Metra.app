'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { DELIVERY_SHARE_OPEN_EVENT } from './share-anchor';
import { ShareLinkPanel } from './share-link-panel';
import { useDeliveryShare } from './use-delivery-share';

/**
 * The client link: share it, show it again (re-derived, never rotated),
 * replace it, or revoke it. Owner/admin only (the caller renders it only with
 * `canShare`; the server actions enforce it).
 *
 * A dialog rather than a bar on the page: sharing is a side action, and as a bar
 * it sat between the header and the command card, pushing the one thing the
 * studio came here to do down the page. It opens from the header's menu (any
 * caller of `revealDeliveryShareLink()`), and by itself whenever there is
 * something to read: a revealed link or a refusal (use-delivery-share.ts).
 */
export function ClientLinkDialog({
  engagementId,
  initialShared,
}: {
  engagementId: string;
  initialShared: boolean;
}) {
  const t = useTranslations('delivery.share');
  const tc = useTranslations('common');
  const share = useDeliveryShare({ engagementId, initialShared });
  const { setOpen } = share;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DELIVERY_SHARE_OPEN_EVENT, onOpen);
  }, [setOpen]);

  return (
    <DialogPrimitive.Root open={share.open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed inset-x-4 top-1/2 z-50 mx-auto max-w-md -translate-y-1/2 rounded-panel border bg-card pt-4 text-start shadow-card outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none">
          <div className="flex items-center gap-2 px-4 pb-2">
            <DialogPrimitive.Title className="text-title font-semibold">
              {t('title')}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton type="button" aria-label={tc('close')} className="ms-auto">
                <X className="size-4" aria-hidden />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{t('title')}</DialogPrimitive.Description>
          <ShareLinkPanel share={share} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
