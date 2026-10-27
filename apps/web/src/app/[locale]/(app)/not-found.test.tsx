import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import AppNotFound from './not-found';

// The in-app 404 (SEO PR1 functional test, F2): studio copy, one heading, and
// the way back to the dashboard rather than the marketing landing.

const locale = vi.hoisted(() => ({ current: 'ar-EG' as string }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    messageAt(locale.current as TestLocale, `${namespace}.${key}`),
}));

describe.each<[TestLocale]>([['ar-EG'], ['en']])('the %s in-app 404 page', (pageLocale) => {
  async function renderPage() {
    locale.current = pageLocale;
    return renderWithIntl(await AppNotFound(), { locale: pageLocale });
  }

  it('has exactly one h1, holding the title', async () => {
    const { container } = await renderPage();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(messageAt(pageLocale, 'shell.notFound.title'));
  });

  it('says what happened and links to the dashboard, not the landing', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('p')?.textContent).toBe(messageAt(pageLocale, 'shell.notFound.body'));
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => [link.getAttribute('href'), link.textContent])).toEqual([
      [`/${pageLocale}/dashboard`, messageAt(pageLocale, 'shell.notFound.cta')],
    ]);
  });
});
