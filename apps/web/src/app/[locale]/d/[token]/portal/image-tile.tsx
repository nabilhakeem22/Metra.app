'use client';

import { ImageOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { bidiIsolate } from '@/lib/format/bidi';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import { pictureUrl } from './document-url';
import { usePictureRetry } from './use-picture-retry';

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
 * nothing until it scrolls into view. A thumbnail that fails shows a plain
 * image mark instead of a broken picture, and tries once more after the
 * routes' Retry-After (./use-picture-retry.ts), so a tile the link's read
 * budget refused still loads. The URL carries no page locale, so a language
 * switch reuses the cached tile.
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
  const label = useImageLabel()(image);
  const picture = usePictureRetry();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={picture.showPicture ? undefined : label}
      title={label}
      className={cn(
        'relative aspect-square min-h-11 min-w-11 overflow-hidden rounded-item border bg-muted outline-none focus-ring-brand',
        className,
      )}
    >
      {!picture.showPicture ? (
        <ImageOff className="absolute inset-0 m-auto size-6 text-muted-foreground" aria-hidden />
      ) : (
        <img
          key={picture.attempt}
          ref={picture.pictureRef}
          src={pictureUrl(token, image.id, 'thumb')}
          alt={label}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={picture.onError}
        />
      )}
    </button>
  );
}
