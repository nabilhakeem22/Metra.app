import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

const FEATURE_KEYS = [
  'feature1',
  'feature2',
  'feature3',
  'feature4',
  'feature5',
] as const;

/**
 * One honest plan: free during early access. No invented price, no fake tiers.
 * The CTA routes to the passwordless `/login` entry.
 */
export function Pricing() {
  const t = useTranslations('landing.pricing');

  return (
    <section className="landing-blk" id="pricing">
      <div className="landing-wrap">
        <div className="landing-sec-head">
          <span className="landing-mono">{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <div className="landing-price">
          <div className="landing-price-card">
            <div className="landing-tag">{t('badge')}</div>
            <div className="landing-mono" style={{ color: 'var(--text-muted)' }}>
              {t('planName')}
            </div>
            <div className="landing-amt">
              {t('amount')}
              <small> {t('amountNote')}</small>
            </div>
            <div className="landing-sub">{t('sub')}</div>
            <ul className="landing-price-list">
              {FEATURE_KEYS.map((key) => (
                <li key={key}>
                  <span className="landing-ck" aria-hidden>
                    ✓
                  </span>
                  {t(key)}
                </li>
              ))}
            </ul>
            <Link
              className="landing-btn landing-btn-primary landing-btn-lg landing-btn-block"
              href="/login"
            >
              {t('cta')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
