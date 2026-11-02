'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { DesignFirstTarget } from '@/lib/engagements/design-first';

/** The way out of a design-first refusal: the delivery it names. Nothing for any other answer. */
export function DesignFirstLink({ target }: { target: DesignFirstTarget | null | undefined }) {
  const t = useTranslations('contracts.designFirst');
  if (!target) return null;
  return (
    <Link
      href={`/engagements/${target.deliveryId}`}
      className="inline-flex min-h-11 items-center text-body font-medium text-primary underline underline-offset-2"
    >
      {t('openDelivery', { delivery: target.delivery })}
    </Link>
  );
}
