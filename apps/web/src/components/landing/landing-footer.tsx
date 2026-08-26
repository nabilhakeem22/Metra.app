import { useTranslations } from 'next-intl';
import { Wordmark } from '@/components/brand/wordmark';
import { LocaleSwitch } from '@/components/shell/locale-switch';
import { Link } from '@/i18n/routing';

/**
 * Marketing footer: wordmark, the section + auth links, the real EN/ع locale
 * toggle (reused from the app shell), and the copyright line.
 */
export function LandingFooter() {
  const t = useTranslations('landing.footer');
  const nav = useTranslations('landing.nav');

  return (
    <footer className="landing-footer">
      <div className="landing-wrap landing-foot-in">
        <Wordmark size="sm" />
        <nav className="landing-foot-links" aria-label={t('label')}>
          <a href="#features">{nav('features')}</a>
          <a href="#how">{nav('howItWorks')}</a>
          <a href="#pricing">{nav('pricing')}</a>
          <Link href="/login">{nav('signIn')}</Link>
          <Link href="/login">{nav('getStarted')}</Link>
        </nav>
        <div className="landing-foot-end">
          <LocaleSwitch />
          <span className="landing-foot-meta">{t('copyright')}</span>
        </div>
      </div>
    </footer>
  );
}
