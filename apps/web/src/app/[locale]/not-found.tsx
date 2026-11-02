import { getTranslations } from 'next-intl/server';
import { LandingNav } from '@/components/landing/landing-nav';
import { Link } from '@/i18n/routing';
import './landing.css';
import './landing-not-found.css';

/**
 * The localized 404, for every unknown path under a locale ([...rest]/page.tsx)
 * and every notFound() below it that has no nearer not-found. Generic copy in
 * فصحى: anyone can land here, a client with a broken link included. No session
 * and no database, so it costs the Worker almost nothing. Next adds the robots
 * noindex meta and the middleware the X-Robots-Tag header.
 */
export default async function NotFound() {
  const t = await getTranslations('landing.notFound');
  return (
    <div className="landing">
      <LandingNav variant="return" />
      <main className="landing-wrap landing-not-found">
        <h1>{t('title')}</h1>
        <p>{t('body')}</p>
        <Link className="landing-btn landing-btn-primary landing-btn-lg" href="/">
          {t('cta')}
        </Link>
      </main>
    </div>
  );
}
