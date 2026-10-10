'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { KeyboardEvent } from 'react';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { documentUrl } from './document-url';
import { DocumentThread } from './document-thread';
import { useImageLabel } from './image-tile';

const ROUND_BUTTON =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border bg-background outline-none focus-ring-brand hover:bg-muted disabled:opacity-40';

/**
 * One picture at a time, large: the document route's `view` (the downscaled
 * preview while money is outstanding, the file itself once paid), with
 * previous and next (buttons, and the arrow keys in the READING direction: in
 * Arabic the left arrow goes forward), close, Download only when the client may
 * have the file, and the picture's own comment thread so a question stays
 * attached to the drawing it is about. Arrow icons mirror in RTL. 44 px targets.
 */
export function Lightbox({
  token,
  images,
  index,
  onIndexChange,
}: {
  token: string;
  images: readonly PortalDocument[];
  /** The picture showing, or null when closed. */
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const t = useTranslations('delivery.lightbox');
  const tDocuments = useTranslations('delivery.documents');
  const locale = useLocale();
  const labelOf = useImageLabel();
  const image = index === null ? null : images[index] ?? null;
  const rtl = locale.startsWith('ar');
  const go = (step: number) => {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < images.length) onIndexChange(next);
  };
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // In the comment box the arrows move the caret, not the picture.
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    go(forward ? 1 : -1);
  }

  return (
    <DialogPrimitive.Root open={image !== null} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className="client-portal fixed inset-2 z-50 mx-auto flex max-w-3xl flex-col gap-3 overflow-y-auto rounded-panel bg-card p-3 text-start shadow-card outline-none"
        >
          {image && index !== null && (
            <>
              <div className="flex items-center gap-2">
                <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-body font-semibold">
                  {labelOf(image)}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-caption text-muted-foreground">
                  {t('position', { current: index + 1, total: images.length })}
                </DialogPrimitive.Description>
                <DialogPrimitive.Close className={ROUND_BUTTON} aria-label={t('close')}>
                  <X className="size-5" aria-hidden />
                </DialogPrimitive.Close>
              </div>
              <img
                key={image.id}
                src={documentUrl(locale, token, image.id, 'view')}
                alt={labelOf(image)}
                className="max-h-[65vh] w-full rounded-item bg-muted object-contain"
              />
              <div className="flex items-center gap-2">
                <button type="button" className={ROUND_BUTTON} aria-label={t('previous')} disabled={index === 0} onClick={() => go(-1)}>
                  <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden />
                </button>
                <button
                  type="button"
                  className={ROUND_BUTTON}
                  aria-label={t('next')}
                  disabled={index === images.length - 1}
                  onClick={() => go(1)}
                >
                  <ChevronRight className="size-5 rtl:rotate-180" aria-hidden />
                </button>
                {image.access === 'download' && (
                  <a href={documentUrl(locale, token, image.id)} className={`${ROUND_BUTTON} ms-auto gap-1.5 px-3 text-caption font-semibold`}>
                    <Download className="size-4" aria-hidden />
                    {tDocuments('download')}
                  </a>
                )}
              </div>
              <DocumentThread key={`thread-${image.id}`} token={token} documentId={image.id} initialCount={image.commentCount} />
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
