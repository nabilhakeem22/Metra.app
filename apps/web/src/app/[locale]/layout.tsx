import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { Manrope, Tajawal } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { LOCALES, dirFor, type Locale } from '@/i18n/routing';
import { getSiteUrl } from '@/lib/seo/site-url';
import '../globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

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
      default: `${siteName} — ${t('title')}`,
      template: `%s · ${siteName}`,
    },
    description: t('description'),
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

  const messages = await getMessages();

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
          <NextIntlClientProvider messages={messages}>
            {children}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
