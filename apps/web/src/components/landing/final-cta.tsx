import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { BlueprintGrid } from './blueprint-grid';

/** Dark closing band mirroring the hero: one more push to the auth entry. */
export function FinalCta() {
  const t = useTranslations('landing.final');

  return (
    <section className="landing-final">
      <BlueprintGrid patternId="landing-grid-final" width={1200} height={400} />
      <div className="landing-wrap landing-final-in">
        <h2>{t('title')}</h2>
        <p>{t('lede')}</p>
        <div className="landing-hero-cta">
          <Link
            className="landing-btn landing-btn-primary landing-btn-lg"
            href="/login"
          >
            {t('ctaPrimary')}
          </Link>
          <Link
            className="landing-btn landing-btn-ghost landing-btn-lg landing-btn-on-dark"
            href="/login"
          >
            {t('ctaSecondary')}
          </Link>
        </div>
      </div>
    </section>
  );
}
