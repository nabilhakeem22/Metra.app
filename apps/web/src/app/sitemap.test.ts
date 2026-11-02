import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANDING_LAST_MODIFIED } from '@/lib/seo/indexable-pages';
import sitemap from './sitemap';

const SITE = 'https://metra.example';

/** UTC+14, the furthest-ahead time zone: the day LANDING_LAST_MODIFIED is bumped has already begun there while it is still the day before in UTC (Cairo is UTC+3). */
const FURTHEST_AHEAD_ZONE_MS = 14 * 3600_000;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', SITE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sitemap.xml', () => {
  it('lists exactly the two landing pages, absolute', () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([`${SITE}/ar-EG`, `${SITE}/en`]);
  });

  it('gives each entry the absolute hreflang alternates with x-default on ar-EG', () => {
    for (const entry of sitemap()) {
      expect(entry.alternates?.languages).toEqual({
        'ar-EG': `${SITE}/ar-EG`,
        en: `${SITE}/en`,
        'x-default': `${SITE}/ar-EG`,
      });
    }
  });

  it('dates every entry with the landing-copy date, not the clock', () => {
    for (const entry of sitemap()) expect(entry.lastModified).toBe(LANDING_LAST_MODIFIED);
    expect(sitemap()).toEqual(sitemap());
  });

  it('keeps the landing-copy date a real YYYY-MM-DD that is not in the future', () => {
    expect(LANDING_LAST_MODIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = new Date(`${LANDING_LAST_MODIFIED}T00:00:00Z`);
    expect(date.toISOString().slice(0, 10)).toBe(LANDING_LAST_MODIFIED);
    expect(date.getTime()).toBeLessThanOrEqual(Date.now() + FURTHEST_AHEAD_ZONE_MS);
  });

  it('marks both entries monthly at full priority', () => {
    for (const entry of sitemap()) {
      expect(entry.changeFrequency).toBe('monthly');
      expect(entry.priority).toBe(1);
    }
  });
});
