'use client';

import { ImageOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import { documentUrl } from './document-url';

/** A picture's name for a screen reader and a broken image: its category and share day. */
export function useImageLabel(): (image: PortalDocument) => string {
  const t = useTranslations('delivery');
  const locale = useLocale();
  return (image) => {
    const category = t(`documents.category.${image.category}`);
    return image.sharedAt
      ? t('gallery.imageAlt', { category, date: bidiIsolate(formatDate(image.sharedAt, locale)) })
      : category;
  };
}

/**
 * One picture as a square tile that opens it (a button, 44 px and up). The
 * thumbnail is the document route's `thumb` variant: a small rendition
 * streamed by the app, never a storage URL. Lazy, so a long gallery costs
 * nothing until it scrolls into view; a thumbnail that fails (a type Storage
 * cannot transform) shows a plain image mark instead of a broken picture.
 */
export function ImageTile({
  token,
  image,
  onOpen,
  className,
}: {
  token: string;
  image: PortalDocument;
  onOpen: () => void;
  className?: string;
}) {
  const locale = useLocale();
  const label = useImageLabel()(image);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={failed ? label : undefined}
      title={label}
      className={cn(
        'relative aspect-square min-h-11 min-w-11 overflow-hidden rounded-item border bg-muted outline-none focus-ring-brand',
        className,
      )}
    >
      {failed ? (
        <ImageOff className="absolute inset-0 m-auto size-6 text-muted-foreground" aria-hidden />
      ) : (
        <img
          src={documentUrl(locale, token, image.id, 'thumb')}
          alt={label}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </button>
  );
}
