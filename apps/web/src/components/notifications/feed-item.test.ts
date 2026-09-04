import { describe, expect, it } from 'vitest';
import {
  notificationBody,
  notificationHref,
  type FeedItem,
} from './feed-item';

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: 'n1',
  kind: 'proposal_expiring',
  bodyKey: 'proposal_expiring',
  params: {},
  entityType: null,
  entityId: null,
  createdAt: '2026-09-01T10:00:00Z',
  read: false,
  ...over,
});

/** Echoes the key and its values, so a test can see exactly what was passed. */
const translate = (key: string, values?: Record<string, string>) =>
  `${key}(${Object.entries(values ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(',')})`;
const formatDate = (iso: string) => `D:${iso}`;

describe('notificationHref', () => {
  it('points at the entity it is about', () => {
    expect(notificationHref(item({ entityType: 'proposal', entityId: 'p1' }))).toBe(
      '/proposals/p1',
    );
    expect(notificationHref(item({ entityType: 'project', entityId: 'x9' }))).toBe(
      '/projects/x9',
    );
  });

  it('returns null when there is nothing to link to', () => {
    expect(notificationHref(item())).toBeNull();
    expect(notificationHref(item({ entityType: 'proposal' }))).toBeNull();
    expect(notificationHref(item({ entityId: 'p1' }))).toBeNull();
    // An entity type nothing knows how to route to.
    expect(
      notificationHref(item({ entityType: 'invoice', entityId: 'i1' })),
    ).toBeNull();
  });
});

describe('notificationBody', () => {
  it('passes NUMBERS AS STRINGS so ar-EG never gets Arabic-Indic digits', () => {
    // The reason this matters: next-intl formats numeric values by locale, and
    // Metra renders Western numerals everywhere.
    const out = notificationBody(
      item({ bodyKey: 'proposal_followup', params: { number: 12, days: 3 } }),
      translate,
      formatDate,
    );
    expect(out).toBe('proposal_followup(number=12,days=3)');
  });

  it('formats a date through the caller’s formatter', () => {
    const out = notificationBody(
      item({ params: { number: 7, expiryDate: '2026-10-01' } }),
      translate,
      formatDate,
    );
    expect(out).toBe('proposal_expiring(number=7,date=D:2026-10-01)');
  });

  it('defaults every missing param to 0 rather than printing undefined', () => {
    const out = notificationBody(
      item({ bodyKey: 'stage_reminder', params: {} }),
      translate,
      formatDate,
    );
    expect(out).toBe('stage_reminder(overdue=0,upcoming=0)');
  });

  it('renders the digest counts', () => {
    const out = notificationBody(
      item({
        bodyKey: 'portfolio_digest',
        params: { activeProjects: 4, awaitingResponse: 2, expiringSoon: 1, overdueStages: 5 },
      }),
      translate,
      formatDate,
    );
    expect(out).toBe('portfolio_digest(active=4,awaiting=2,expiring=1,overdue=5)');
  });

  it('returns an empty line for an unknown kind instead of throwing', () => {
    // A notification kind added server-side must not break an older bell.
    expect(notificationBody(item({ bodyKey: 'not_a_kind' }), translate, formatDate)).toBe(
      '',
    );
  });
});
