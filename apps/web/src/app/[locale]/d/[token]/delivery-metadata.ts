import type { Metadata } from 'next';
import type { DeliveryReadResult } from '@/lib/engagements/public/delivery';
import { deliveryDisplayNames } from '@/lib/engagements/public/display-names';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';

/** A `delivery.*` translator: the client page's own (فصحى / English) words. */
/**
 * Never indexed, and no number on the page is turned into a link by the
 * browser: the studio's InstaPay address and account numbers are text to copy,
 * never something a tap dials or opens (iOS Safari links digit runs otherwise).
 */
const CLIENT_PAGE_METADATA: Metadata = {
  ...PRIVATE_METADATA,
  formatDetection: { telephone: false, email: false, address: false },
};

export type DeliveryTranslator = (key: string, values?: Record<string, string>) => string;

/**
 * The client page's <title> and description. PURE given a translator.
 *
 * The client's browser tab and the preview card of the link the studio sends
 * them show these, so they are the delivery's own words (the project and the
 * studio, in the client's register), never the studio app's marketing copy the
 * root layout falls back to. `absolute` keeps the layout's "· Metra" template
 * off. Never indexed (PRIVATE_METADATA).
 */
export function deliveryMetadata(read: DeliveryReadResult, locale: string, t: DeliveryTranslator): Metadata {
  if (read.status !== 'ok') {
    const notice = read.status === 'read_failed' ? 'readFailed' : 'notFound';
    return { ...CLIENT_PAGE_METADATA, title: { absolute: t(`${notice}.title`) }, description: t(`${notice}.body`) };
  }
  const { firmName, title } = deliveryDisplayNames(read.delivery, locale);
  return {
    ...CLIENT_PAGE_METADATA,
    title: { absolute: title ? `${title} · ${firmName}` : firmName },
    description: t('meta.description', { firm: firmName }),
  };
}
