import { useTranslations } from 'next-intl';

/**
 * Problem/value split: the pain on one side, and a traceability card (the
 * revised-contract-value figure + the four-stage progress rail) on the other.
 * The figure is illustrative; the progress rail is decorative.
 */
export function ProblemValue() {
  const t = useTranslations('landing.problem');

  return (
    <section className="landing-blk">
      <div className="landing-wrap landing-split">
        <div>
          <span
            className="landing-mono"
            style={{ color: 'var(--brand-ink)' }}
          >
            {t('eyebrow')}
          </span>
          <h2>{t('title')}</h2>
          <p className="landing-split-lede">{t('lede')}</p>
          <ul className="landing-val-list">
            <li>
              <span className="landing-ic" aria-hidden>
                ✓
              </span>
              <div>
                <b>{t('value1Title')}</b> <span>{t('value1Desc')}</span>
              </div>
            </li>
            <li>
              <span className="landing-ic" aria-hidden>
                ✓
              </span>
              <div>
                <b>{t('value2Title')}</b> <span>{t('value2Desc')}</span>
              </div>
            </li>
            <li>
              <span className="landing-ic" aria-hidden>
                ✓
              </span>
              <div>
                <b>{t('value3Title')}</b> <span>{t('value3Desc')}</span>
              </div>
            </li>
          </ul>
        </div>
        <div className="landing-quote-card">
          <div className="landing-mono" style={{ color: 'var(--text-muted)' }}>
            {t('cardLabel')}
          </div>
          <div className="landing-big landing-num">
            1,284,500<small>.00</small>
          </div>
          <div className="landing-cap">{t('cardCaption')}</div>
          <hr />
          <div className="landing-mono" style={{ color: 'var(--text-muted)' }}>
            {t('cardProgressLabel')}
          </div>
          <div className="landing-progress" aria-hidden>
            <span className="on" />
            <span className="on-soft" />
            <span />
            <span />
          </div>
          <div className="landing-cap" style={{ marginBlockStart: '10px' }}>
            {t('cardStages')}
          </div>
        </div>
      </div>
    </section>
  );
}
