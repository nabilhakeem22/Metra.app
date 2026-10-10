'use client';

import { Images, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import { ImageTile } from './image-tile';
import { Lightbox } from './lightbox';

/** How many pictures the strip shows before "View all". */
export const WORK_STRIP_MAX = 4;

const TEXT_LINK =
  'inline-flex min-h-11 items-center gap-1.5 rounded-pill px-1 text-body font-medium text-primary underline-offset-4 hover:underline';

/**
 * "See the work": right under a review hero's Approve, up to four pictures of
 * what the client is asked to approve (the concept options, or the final
 * renders), each opening the lightbox (by picture id, so a refresh never swaps
 * the picture), and "View all" when there are more. When some of that work
 * cannot be looked at yet (withheld until a payment, F8) it says so, so the
 * client is never asked to approve blind; with nothing at all to show, a link
 * down to the documents. 44 px targets.
 */
export function HeroWorkStrip({
  token,
  images,
  lockedCount,
}: {
  token: string;
  images: readonly PortalDocument[];
  /** Files of this work the client cannot open yet. */
  lockedCount: number;
}) {
  const t = useTranslations('delivery.hero.work');
  const [openId, setOpenId] = useState<string | null>(null);
  const locked = lockedCount > 0 && (
    <p className="flex items-start gap-1.5 text-body text-muted-foreground">
      <Lock className="mt-1 size-4 shrink-0" aria-hidden />
      {t('locked')}
    </p>
  );

  if (images.length === 0) {
    return (
      locked || (
        <a href="#documents" className={TEXT_LINK}>
          <Images className="size-4" aria-hidden />
          {t('seeFiles')}
        </a>
      )
    );
  }

  return (
    <div className="space-y-1.5" role="group" aria-label={t('title')}>
      <ul className="grid grid-cols-4 gap-2">
        {images.slice(0, WORK_STRIP_MAX).map((image) => (
          <li key={image.id}>
            <ImageTile token={token} image={image} className="w-full" onOpen={() => setOpenId(image.id)} />
          </li>
        ))}
      </ul>
      {images.length > WORK_STRIP_MAX && (
        <button type="button" onClick={() => setOpenId(images[0]!.id)} className={TEXT_LINK}>
          {t('viewAll', { count: images.length })}
        </button>
      )}
      {locked}
      <Lightbox token={token} images={images} openId={openId} onOpenIdChange={setOpenId} />
    </div>
  );
}
