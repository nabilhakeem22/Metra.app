import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Manrope, Tajawal } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { LOCALES, dirFor, type Locale } from '@/i18n/routing';
import { ScopedIntlProvider } from '@/i18n/scoped-intl-provider';
import { getSiteUrl } from '@/lib/seo/site-url';
import '../globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

// Loaded weights = used weights. The app uses normal / medium / semibold /
// bold (lint bans the rest). Tajawal ships no 600, so semibold resolves to the
// real 700 face by CSS weight matching, never a synthesized bold.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '700'],
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
  if (!LOCALES.includes(locale as Locale)) {
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
