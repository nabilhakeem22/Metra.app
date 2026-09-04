// The shape of one notification as the UI shows it, plus how to turn it into a
// sentence and a destination. PURE and CLIENT-SAFE: no db import, no `server-only`,
// no 'use client'.
//
// Extracted from the notifications page so the header BELL DROPDOWN and the full
// feed resolve a notification identically. Two copies of this would drift the moment
// a new notification kind was added, and the copy nobody remembered would render an
// empty line.

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

/** Where a notification points, by the entity it is about. */
export const ENTITY_HREF: Record<string, (id: string) => string> = {
  proposal: (id) => `/proposals/${id}`,
  project: (id) => `/projects/${id}`,
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
 * `translate` and `formatDate` are passed in rather than imported so this stays a
 * pure function usable from any component — and testable without a React tree.
 *
 * NUMERIC PARAMS ARE PASSED AS STRINGS on purpose: next-intl would otherwise apply
 * locale number formatting and emit Arabic-Indic digits for ar-EG, and Metra renders
 * Western numerals everywhere.
 */
export function notificationBody(
  item: FeedItem,
  translate: (key: string, values?: Record<string, string>) => string,
  formatDate: (iso: string) => string,
): string {
  const p = item.params;
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
      return translate('portfolio_digest', {
        active: s(p.activeProjects),
        awaiting: s(p.awaitingResponse),
        expiring: s(p.expiringSoon),
        overdue: s(p.overdueStages),
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
