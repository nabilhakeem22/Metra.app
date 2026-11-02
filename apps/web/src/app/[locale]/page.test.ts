import { describe, expect, it, vi } from 'vitest';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// The landing's metadata (SEO PR1 functional test, F4): only a real locale gets
// the indexable canonical, hreflang and "index, follow". The route also matches
// a single-segment junk path such as /wp-login.php, which the layout answers 404.

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => (key: string) =>
    messageAt(locale as TestLocale, `${namespace}.${key}`),
  setRequestLocale: () => {},
}));

const { generateMetadata } = await import('./page');

function metadataFor(locale: string) {
  return generateMetadata({ params: Promise.resolve({ locale }) });
}

describe('the landing page metadata', () => {
  it.each(['ar-EG', 'en'])('is the indexable landing metadata for %s', async (locale) => {
    const metadata = await metadataFor(locale);
    expect(metadata.alternates?.canonical).toBe(`/${locale}`);
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it.each(['wp-login.php', 'apple-touch-icon-precomposed.png', 'AR-EG', 'fr'])(
    'is empty for the non-locale segment %s',
    async (segment) => {
      expect(await metadataFor(segment)).toEqual({});
    },
  );
});
