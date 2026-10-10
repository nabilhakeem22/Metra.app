'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { picturesByCategory, type PortalDocument } from '@/lib/engagements/portal-gallery';
import { ImageTile } from './image-tile';
import { Lightbox } from './lightbox';

/**
 * The client's pictures (released images they may at least preview), newest
 * first, grouped by category, as tiles: two across on a phone, three from
 * 768 px. A tile opens the lightbox, which steps through every picture in the
 * order shown. Nothing when there are no pictures.
 */
export function Gallery({ token, images }: { token: string; images: readonly PortalDocument[] }) {
  const t = useTranslations('delivery.documents');
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const groups = picturesByCategory(images);
  // The lightbox steps in the order the tiles read: group by group.
  const ordered = groups.flatMap((group) => group.images);

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.category} className="space-y-1.5">
          <h3 className="text-caption font-semibold text-muted-foreground">{t(`category.${group.category}`)}</h3>
          <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {group.images.map((image) => (
              <li key={image.id}>
                <ImageTile token={token} image={image} className="w-full" onOpen={() => setOpen(ordered.indexOf(image))} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Lightbox token={token} images={ordered} index={open} onIndexChange={setOpen} />
    </div>
  );
}
