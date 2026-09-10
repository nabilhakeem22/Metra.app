import { useLocale, useTranslations } from 'next-intl';
import { Wordmark } from '@/components/brand/wordmark';
import { Link } from '@/i18n/routing';

/**
 * Sticky marketing nav: wordmark, in-page section links, and the two auth CTAs.
 * Both CTAs route to the passwordless `/login` entry — the landing never embeds
 * the sign-in form itself.
 *
 * `variant="return"` is the same bar on the SIGN-IN page, so a visitor who
 * arrived at the form can get back out to the site. Two things change, and both
 * have to: the section links become absolute (`/#features`), because a bare
 * `#features` on `/login` scrolls to nothing; and the auth CTAs go, because
 * "Sign in" on the sign-in page is a link to where you already are, and the
 * sign-up switch already sits under the form.
 */
export function LandingNav({
  variant = 'full',
}: {
  variant?: 'full' | 'return';
}) {
  const t = useTranslations('landing.nav');
  const locale = useLocale();
  const onSite = variant === 'full';
  // On the landing page these stay bare hashes so the browser scrolls in place
  // instead of re-navigating the route. Off it they carry the LOCALE with them:
  // a bare `/#features` lands on the unprefixed root and leans on a redirect to
  // guess the language back, which is a wasted hop and can guess differently
  // from the page the visitor was just on.
  const section = (id: string) => (onSite ? `#${id}` : `/${locale}#${id}`);

  return (
    <nav className="landing-nav" aria-label={t('primaryLabel')}>
      <div className="landing-wrap landing-nav-in">
        <Link href="/" aria-label="Metra">
          <Wordmark />
        </Link>
        <div className="landing-nav-links">
          <a href={section('features')}>{t('features')}</a>
          <a href={section('how')}>{t('howItWorks')}</a>
          <a href={section('pricing')}>{t('pricing')}</a>
        </div>
        {onSite && (
          <div className="landing-nav-cta">
            <Link
              className="landing-btn landing-btn-ghost"
              href={{ pathname: '/login', query: { mode: 'signin' } }}
            >
              {t('signIn')}
            </Link>
            <Link
              className="landing-btn landing-btn-primary"
              href={{ pathname: '/login', query: { mode: 'signup' } }}
            >
              {t('getStarted')}
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
