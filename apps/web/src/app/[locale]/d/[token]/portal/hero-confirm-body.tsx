'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PortalDocument } from '@/lib/engagements/portal-gallery';
import type { HeroGroup } from '@/lib/engagements/portal-hero';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { BudgetRange } from './budget-range';
import { documentUrl } from './document-url';
import { useImageLabel } from './image-tile';

/**
 * What the "Approve?" confirmation says: the first picture of the work being
 * approved (so the client confirms what they saw), the group's consequence
 * line, and, when the final approval also acknowledges the budget range, the
 * range itself and a line saying so.
 */
export function HeroConfirmBody({
  token,
  group,
  firstImage,
  budget,
}: {
  token: string;
  group: HeroGroup;
  firstImage: PortalDocument | null;
  /** The issued range this approval also acknowledges, or null. */
  budget: NonNullable<PublicDelivery['rom']> | null;
}) {
  const tGroup = useTranslations(`delivery.hero.${group}`);
  const tDesign = useTranslations('delivery.hero.design');
  const locale = useLocale();
  const labelOf = useImageLabel();
  return (
    <>
      {firstImage && (
        <img
          src={documentUrl(locale, token, firstImage.id, 'thumb')}
          alt={labelOf(firstImage)}
          className="mx-auto max-h-40 rounded-item border bg-muted object-cover"
        />
      )}
      <p>{tGroup('confirmBody')}</p>
      {budget && (
        <div className="space-y-1.5 rounded-item border p-3">
          <BudgetRange rom={budget} />
          <p className="font-medium text-foreground">{tDesign('confirmWithBudget')}</p>
        </div>
      )}
    </>
  );
}
