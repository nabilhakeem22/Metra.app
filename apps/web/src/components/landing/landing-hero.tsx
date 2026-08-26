import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { BlueprintGrid } from './blueprint-grid';

/**
 * Dark blueprint-grid hero: eyebrow, the page's single <h1> (with a gradient
 * "handoff" accent via rich text), lede, the two CTAs, and a decorative
 * product-hint card. The card's figures are illustrative placeholders, so the
 * whole card is hidden from assistive tech.
 */
export function LandingHero() {
  const t = useTranslations('landing.hero');

  return (
    <header className="landing-hero">
      <BlueprintGrid patternId="landing-grid-hero" width={1200} height={600} />
      <div className="landing-wrap landing-hero-in">
        <div>
          <span className="landing-eyebrow landing-mono">
            <span className="landing-dot" aria-hidden />
            {t('eyebrow')}
          </span>
          <h1>
            {t.rich('headline', {
              accent: (chunks) => (
                <span className="landing-accent">{chunks}</span>
              ),
            })}
          </h1>
          <p className="landing-lede">{t('lede')}</p>
          <div className="landing-hero-cta">
            <Link
              className="landing-btn landing-btn-primary landing-btn-lg"
              href={{ pathname: '/login', query: { mode: 'signup' } }}
            >
              {t('ctaPrimary')}
            </Link>
            <a
              className="landing-btn landing-btn-ghost landing-btn-lg landing-btn-on-dark"
              href="#how"
            >
              {t('ctaSecondary')}
            </a>
          </div>
          <p className="landing-hero-note">
            <span aria-hidden>✓</span>
            {t('note')}
          </p>
        </div>
        <ProductHintCard />
      </div>
    </header>
  );
}

/** Decorative product screenshot stand-in — illustrative figures only. */
function ProductHintCard() {
  const t = useTranslations('landing.hero.card');

  return (
    <div className="landing-shot" aria-hidden>
      <div className="landing-shot-top">
        <i />
        <i />
        <i />
      </div>
      <div className="landing-shot-body">
        <div className="landing-rail">
          <div className="landing-st done">{t('stageConcept')}</div>
          <div className="landing-st on">{t('stageGateA')}</div>
          <div className="landing-st">{t('stage3d')}</div>
          <div className="landing-st">{t('stageHandoff')}</div>
        </div>
        <div className="landing-mrow">
          <span>{t('contractTotalLabel')}</span>
          <b className="landing-num">EGP 150,000</b>
        </div>
        <div className="landing-mrow">
          <span>{t('depositLabel')}</span>
          <span className="landing-pill">{t('depositStatus')}</span>
          <b className="landing-num">30,000</b>
        </div>
        <div className="landing-mrow">
          <span>{t('gateLabel')}</span>
          <span className="landing-pill due">{t('gateStatus')}</span>
          <b className="landing-num">45,000</b>
        </div>
        <div className="landing-mrow">
          <span>{t('marginLabel')}</span>
          <b className="landing-num" style={{ color: '#7fd8b0' }}>
            32%
          </b>
        </div>
      </div>
    </div>
  );
}
