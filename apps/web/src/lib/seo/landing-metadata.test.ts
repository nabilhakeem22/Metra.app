import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n/routing';
import arEG from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { buildLandingMetadata } from './landing-metadata';

const CATALOGS: Record<Locale, typeof en> = { 'ar-EG': arEG, en };

afterEach(() => {
  vi.unstubAllEnvs();
});

function metadataFor(locale: Locale) {
  const catalog = CATALOGS[locale];
  return buildLandingMetadata({
    locale,
    title: catalog.landing.seo.title,
    description: catalog.landing.seo.description,
    siteName: catalog.meta.siteName,
    ogImageAlt: catalog.landing.seo.ogImageAlt,
  });
}

/** Every string anywhere inside a value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

describe.each<[Locale, string, string]>([
  ['ar-EG', 'ar_EG', 'en_US'],
  ['en', 'en_US', 'ar_EG'],
])('the %s landing metadata', (locale, ogLocale, otherOgLocale) => {
  const seo = CATALOGS[locale].landing.seo;

  it('uses the catalog title as an absolute title and the catalog description', () => {
    const metadata = metadataFor(locale);
    expect(metadata.title).toEqual({ absolute: seo.title });
    expect(metadata.description).toBe(seo.description);
  });

  it('is canonical to its own landing with three hreflang alternates', () => {
    const { alternates } = metadataFor(locale);
    expect(alternates?.canonical).toBe(`/${locale}`);
    expect(alternates?.languages).toEqual({ 'ar-EG': '/ar-EG', en: '/en', 'x-default': '/ar-EG' });
  });

  it('shares the static 1200x630 card of its locale with the catalog alt text', () => {
    const { openGraph, twitter } = metadataFor(locale);
    expect(openGraph?.images).toEqual([{ url: `/og/og.${locale}.png`, width: 1200, height: 630, alt: seo.ogImageAlt }]);
    expect(twitter).toMatchObject({ card: 'summary_large_image', images: [`/og/og.${locale}.png`] });
  });

  it('names its Open Graph locale and the other one as the alternate', () => {
    const { openGraph } = metadataFor(locale);
    expect(openGraph).toMatchObject({ locale: ogLocale, alternateLocale: [otherOgLocale], url: `/${locale}`, type: 'website' });
  });

  it('is indexable', () => {
    expect(metadataFor(locale).robots).toMatchObject({ index: true, follow: true });
  });

  it('has no verification tags while the variables are blank', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', '');
    vi.stubEnv('NEXT_PUBLIC_BING_SITE_VERIFICATION', '');
    expect(metadataFor(locale)).not.toHaveProperty('verification');
  });

  it('carries both verification tags when the variables hold valid tokens', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', 'google_Token-123');
    vi.stubEnv('NEXT_PUBLIC_BING_SITE_VERIFICATION', 'ABCDEF0123456789');
    expect(metadataFor(locale).verification).toEqual({ google: 'google_Token-123', other: { 'msvalidate.01': 'ABCDEF0123456789' } });
  });

  it('fails on a malformed verification token', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION', 'bad token<');
    expect(() => metadataFor(locale)).toThrow();
  });

  it('contains no em or en dash', () => {
    for (const text of stringsIn(metadataFor(locale))) expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
