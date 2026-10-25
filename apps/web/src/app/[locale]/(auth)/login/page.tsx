import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/routing';
import { LoginForm } from './login-form';

// Pre-rendered at build time, one page per locale, and served as a static
// asset before the Worker runs (Workers Free plan CPU relief; the build's
// scripts/emit-static-pages.mjs copies the HTML). `dynamic = 'error'` fails the
// build if anything here reaches a request-time API. The `?mode` framing is
// read in the browser (login-mode.tsx), and the form posts to app/api/auth:
// a server action would post to this page's URL, which is a 405 on an asset.
export const dynamic = 'error';

export function generateStaticParams(): { locale: Locale }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LoginForm />;
}
