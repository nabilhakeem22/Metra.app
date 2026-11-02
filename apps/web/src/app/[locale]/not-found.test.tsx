import { describe, expect, it, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import NotFound from './not-found';

// The localized 404 (plan C11): one heading, the catalog's three strings and the
// way back to the page locale's landing, in both locales.

const locale = vi.hoisted(() => ({ current: 'ar-EG' as string }));
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    messageAt(locale.current as TestLocale, `${namespace}.${key}`),
}));

describe.each<[TestLocale]>([['ar-EG'], ['en']])('the %s 404 page', (pageLocale) => {
  async function renderPage() {
    locale.current = pageLocale;
    return renderWithIntl(await NotFound(), { locale: pageLocale });
  }

  it('has exactly one h1, holding the title', async () => {
    const { container } = await renderPage();
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(messageAt(pageLocale, 'landing.notFound.title'));
  });

  it('says what happened and links home to the landing of its locale', async () => {
    const { container } = await renderPage();
    const main = container.querySelector('main');
    expect(main?.querySelector('p')?.textContent).toBe(messageAt(pageLocale, 'landing.notFound.body'));
    const home = [...(main?.querySelectorAll('a') ?? [])];
    expect(home.map((link) => [link.getAttribute('href'), link.textContent])).toEqual([
      [`/${pageLocale}`, messageAt(pageLocale, 'landing.notFound.cta')],
    ]);
  });
});
