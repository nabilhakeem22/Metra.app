import { useTranslations } from 'next-intl';
import { WordReveal } from './word-reveal';

/**
 * Honest positioning band beneath the hero — a single statement of who Metra is
 * for. No client names, logos, or testimonials (none exist yet).
 */
export function TrustBand() {
  const t = useTranslations('landing.trust');

  return (
    <div className="landing-trust">
      <div className="landing-wrap">
        <WordReveal text={t('line')} />
      </div>
    </div>
  );
}
