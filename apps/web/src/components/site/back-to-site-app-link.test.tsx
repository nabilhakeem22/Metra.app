import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '@/test/render-with-intl';
import { BackToSiteAppLink } from './back-to-site-app-link';

// The way back into the site app from the costs and measurements pages it
// opens with ?from=site (plan C6): shown only then, and a full-page link to the
// app shell of the page's locale.

const locale = vi.hoisted(() => ({ current: 'ar-EG' }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
  getLocale: async () => locale.current,
}));

describe('BackToSiteAppLink', () => {
  it.each([['ar-EG'], ['en']])('opened from the site app (%s): links to that locale shell', async (pageLocale) => {
    locale.current = pageLocale;
    const { container } = renderWithIntl(await BackToSiteAppLink({ from: 'site' }), { locale: 'en' });
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe(`/${pageLocale}/site`);
    expect(link?.textContent).toBe('site.backToApp');
  });

  it.each([[undefined], ['studio'], [['site', 'site']]])('says nothing when the page was not opened from the app (from=%s)', async (from) => {
    expect(await BackToSiteAppLink({ from })).toBeNull();
  });
});
