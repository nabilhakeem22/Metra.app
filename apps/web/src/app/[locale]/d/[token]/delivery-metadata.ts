import type { Metadata } from 'next';
import { deliveryDisplayNames, type DeliveryNamesSource } from '@/lib/engagements/public/display-names';
import type { PhaseKey } from '@/lib/flow/types';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';

/**
 * Never indexed, and no number on the page is turned into a link by the
 * browser: the studio's InstaPay address and account numbers are text to copy,
 * never something a tap dials or opens (iOS Safari links digit runs otherwise).
 */
const CLIENT_PAGE_METADATA: Metadata = {
  ...PRIVATE_METADATA,
  formatDetection: { telephone: false, email: false, address: false },
};

/** A `delivery.*` translator: the client page's own (فصحى / English) words. */
export type DeliveryTranslator = (key: string, values?: Record<string, string>) => string;

/** The read the page rendered, as far as its names go: the design tab's delivery or the Execution tab's home. */
export type NamedRead = { status: 'ok'; delivery: DeliveryNamesSource } | { status: 'not_found' } | { status: 'read_failed' };

/**
 * The client page's <title> and description. PURE given a translator.
 *
 * The client's browser tab and the preview card of the link the studio sends
 * them show these, so they are the delivery's own words (the project and the
 * studio, in the client's register, about the phase the link opens), never the
 * studio app's marketing copy the root layout falls back to. `absolute` keeps
 * the layout's "· Metra" template off. Never indexed (PRIVATE_METADATA).
 */
export function deliveryMetadata(read: NamedRead, phase: PhaseKey, locale: string, t: DeliveryTranslator): Metadata {
  if (read.status !== 'ok') {
    const notice = read.status === 'read_failed' ? 'readFailed' : 'notFound';
    return { ...CLIENT_PAGE_METADATA, title: { absolute: t(`${notice}.title`) }, description: t(`${notice}.body`) };
  }
  const { firmName, title } = deliveryDisplayNames(read.delivery, locale);
  return {
    ...CLIENT_PAGE_METADATA,
    title: { absolute: title ? `${title} · ${firmName}` : firmName },
    description: t(`meta.description.${phase}`, { firm: firmName }),
  };
}
