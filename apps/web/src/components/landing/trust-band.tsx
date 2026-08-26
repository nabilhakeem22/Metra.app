import { useTranslations } from 'next-intl';

/**
 * Honest positioning band beneath the hero — a single statement of who Metra is
 * for. No client names, logos, or testimonials (none exist yet).
 */
export function TrustBand() {
  const t = useTranslations('landing.trust');

  return (
    <div className="landing-trust">
      <div className="landing-wrap">
        <p>{t('line')}</p>
      </div>
    </div>
  );
}
