import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { dirFor, isLocale } from '@/i18n/routing';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';
import { getSiteUrl } from '@/lib/seo/site-url';
import '../globals.css';

// Both families are files under app/fonts (the Fontsource builds of the Google
// Fonts files, SIL OFL 1.1, licence beside each family), so a build fetches
// nothing. fonts/bundled-fonts.test.ts holds every path below against the disk.
//
// next/font/local takes ONE `declarations` list per call, never one per file.
// Manrope is a single subset, so it carries the Latin unicode-range Google
// served with it.
const manrope = localFont({
  src: [
    { path: '../fonts/manrope/manrope-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/manrope/manrope-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/manrope/manrope-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/manrope/manrope-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
  variable: '--font-manrope',
  display: 'swap',
});

// Loaded weights = used weights. The app uses normal / medium / semibold /
// bold (lint bans the rest). Tajawal ships no 600, so semibold resolves to the
// real 700 face by CSS weight matching, never a synthesized bold.
//
// Two subsets per weight and no unicode-range (see above), so a browser picks
// by what each file contains and asks the LAST declared face first. Latin stays
// last: that is Google's order, and next/font sizes the fallback font from the
// last 400 file, which must be the one with Latin letters.
const tajawal = localFont({
  src: [
    { path: '../fonts/tajawal/tajawal-arabic-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/tajawal/tajawal-arabic-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/tajawal/tajawal-arabic-700-normal.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/tajawal/tajawal-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/tajawal/tajawal-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/tajawal/tajawal-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-tajawal',
  display: 'swap',
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta' });
  const siteName = t('siteName');

  return {
    // Resolves OG/canonical/alternate relative URLs to absolute ones.
    metadataBase: new URL(getSiteUrl()),
    title: {
      // `·` rather than an em dash: — is not Arabic punctuation, and this
      // title renders in ar-EG too (see scripts/i18n/style-guide.md rule 6).
      // It also matches the `%s · siteName` template just below.
      default: `${siteName} · ${t('title')}`,
      template: `%s · ${siteName}`,
    },
    description: t('description'),
    // Static files in public/, so a favicon probe never reaches the Worker.
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: '48x48' },
        { url: '/icon.svg', type: 'image/svg+xml' },
      ],
      apple: '/apple-touch-icon.png',
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  // The locale from the path, so a page can be pre-rendered without reading the
  // request headers (the static landing and login pages).
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      className={`${manrope.variable} ${tajawal.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          value={{ light: 'light', dark: 'dark' }}
        >
          {/* Each route group scopes its own (src/i18n/client-namespaces.ts). */}
          <ScopedIntlProvider scope="root">{children}</ScopedIntlProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
