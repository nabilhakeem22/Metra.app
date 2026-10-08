// The shape of one notification as the UI shows it, plus how to turn it into a
// sentence and a destination. PURE and CLIENT-SAFE: no db import, no `server-only`,
// no 'use client'.
//
// Extracted from the notifications page so the header BELL DROPDOWN and the full
// feed resolve a notification identically. Two copies of this would drift the moment
// a new notification kind was added, and the copy nobody remembered would render an
// empty line.
import {
  clientRespondedBody,
  isClientRespondedBodyKey,
  type BodyTranslate,
} from './client-responded-body';
import { deliveryLabelOf } from './delivery-label';

export interface FeedItem {
  id: string;
  kind: string;
  bodyKey: string;
  params: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  read: boolean;
}

/** How many notifications the bell shows, and so how many a poll reads. */
export const BELL_FEED_LIMIT = 8;

/** How many the notifications page reads; the shared poll keeps the newest current. */
export const PAGE_FEED_LIMIT = 50;

/** The bell's and the page's data: what is unread, and the newest items. */
export interface NotificationFeed {
  unreadCount: number;
  items: FeedItem[];
}

/** Where a notification points, by the entity it is about. */
export const ENTITY_HREF: Record<string, (id: string) => string> = {
  proposal: (id) => `/proposals/${id}`,
  project: (id) => `/projects/${id}`,
  engagement: (id) => `/engagements/${id}`,
};

/** The destination for one item, or null when it is not about a linkable entity. */
export function notificationHref(item: FeedItem): string | null {
  if (!item.entityType || !item.entityId) return null;
  const build = ENTITY_HREF[item.entityType];
  return build ? build(item.entityId) : null;
}

/**
 * The localized body line for one notification.
 *
 * `translate`, `formatDate` and `milestoneLabel` (a payment milestone's name, or
 * null for a kind it does not know) are passed in rather than imported so this
 * stays a pure function usable from any component, and testable without a React
 * tree. `locale` picks a delivery's title.
 *
 * NUMERIC PARAMS ARE PASSED AS STRINGS on purpose: next-intl would otherwise apply
 * locale number formatting and emit Arabic-Indic digits for ar-EG, and Metra renders
 * Western numerals everywhere.
 */
export function notificationBody(
  item: FeedItem,
  translate: BodyTranslate,
  formatDate: (iso: string) => string,
  locale: string,
  milestoneLabel: (kind: string) => string | null,
): string {
  const p = item.params;
  if (isClientRespondedBodyKey(item.bodyKey)) {
    return clientRespondedBody(item.bodyKey, p, translate, locale, milestoneLabel);
  }
  const s = (v: unknown) => String(v ?? 0);
  switch (item.bodyKey) {
    case 'proposal_expiring':
      return translate('proposal_expiring', {
        number: s(p.number),
        date: formatDate(String(p.expiryDate ?? '')),
      });
    case 'proposal_followup':
      return translate('proposal_followup', {
        number: s(p.number),
        days: s(p.days),
      });
    case 'portfolio_digest':
      return [
        translate('portfolio_digest', {
          active: s(p.activeProjects),
          awaiting: s(p.awaitingResponse),
          expiring: s(p.expiringSoon),
          overdue: s(p.overdueStages),
        }),
        // Digests written before Round C carry no delivery counts: they read as before.
        typeof p.deliveriesYourMove === 'number'
          ? translate('portfolio_digest_deliveries', {
              yourMove: s(p.deliveriesYourMove),
              waiting: s(p.deliveriesWaiting),
              stalled: s(p.deliveriesStalled),
            })
          : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'delivery_waiting_on_client':
      return translate('delivery_waiting_on_client', {
        delivery: deliveryLabelOf(p, locale),
        days: s(p.days),
      });
    case 'stage_reminder':
      return translate('stage_reminder', {
        overdue: s(p.overdueCount),
        upcoming: s(p.upcomingCount),
      });
    default:
      // An unknown bodyKey renders as an empty line rather than throwing — a new
      // notification kind reaching an older client must not break the bell.
      return '';
  }
}
