import { useTranslations } from 'next-intl';
import { Wordmark } from '@/components/brand/wordmark';
import { Link } from '@/i18n/routing';

/**
 * Sticky marketing nav: wordmark, in-page section links, and the two auth CTAs.
 * Both CTAs route to the passwordless `/login` entry — the landing never embeds
 * the sign-in form itself.
 */
export function LandingNav() {
  const t = useTranslations('landing.nav');

  return (
    <nav className="landing-nav" aria-label={t('primaryLabel')}>
      <div className="landing-wrap landing-nav-in">
        <Link href="/" aria-label="Metra">
          <Wordmark />
        </Link>
        <div className="landing-nav-links">
          <a href="#features">{t('features')}</a>
          <a href="#how">{t('howItWorks')}</a>
          <a href="#pricing">{t('pricing')}</a>
        </div>
        <div className="landing-nav-cta">
          <Link className="landing-btn landing-btn-ghost" href="/login">
            {t('signIn')}
          </Link>
          <Link className="landing-btn landing-btn-primary" href="/login">
            {t('getStarted')}
          </Link>
        </div>
      </div>
    </nav>
  );
}
