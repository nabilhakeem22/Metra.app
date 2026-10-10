'use client';

import { Images } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { ImageTile } from './image-tile';
import { Lightbox } from './lightbox';

/** How many pictures the strip shows before "View all". */
export const WORK_STRIP_MAX = 4;

/**
 * "See the work first": above a review hero's buttons, up to four pictures of
 * what the client is asked to approve (the concept options, or the final
 * renders), each opening the lightbox, and "View all" when there are more.
 * With no picture to show, a link down to the documents instead. 44 px targets.
 */
export function HeroWorkStrip({ token, images }: { token: string; images: readonly PortalDocument[] }) {
  const t = useTranslations('delivery.hero.work');
  const [open, setOpen] = useState<number | null>(null);

  if (images.length === 0) {
    return (
      <a
        href="#documents"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-1 text-body font-medium text-primary underline-offset-4 hover:underline"
      >
        <Images className="size-4" aria-hidden />
        {t('seeFiles')}
      </a>
    );
  }

  return (
    <div className="space-y-1.5" role="group" aria-label={t('title')}>
      <ul className="grid grid-cols-4 gap-2">
        {images.slice(0, WORK_STRIP_MAX).map((image, index) => (
          <li key={image.id}>
            <ImageTile token={token} image={image} className="w-full" onOpen={() => setOpen(index)} />
          </li>
        ))}
      </ul>
      {images.length > WORK_STRIP_MAX && (
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="inline-flex min-h-11 items-center rounded-pill px-1 text-body font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('viewAll', { count: images.length })}
        </button>
      )}
      <Lightbox token={token} images={images} index={open} onIndexChange={setOpen} />
    </div>
  );
}
