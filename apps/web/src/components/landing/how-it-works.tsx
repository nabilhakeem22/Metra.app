import { useTranslations } from 'next-intl';

interface StepDef {
  number: string;
  titleKey: string;
  descKey: string;
}

const STEPS: StepDef[] = [
  { number: '01', titleKey: 'step1Title', descKey: 'step1Desc' },
  { number: '02', titleKey: 'step2Title', descKey: 'step2Desc' },
  { number: '03', titleKey: 'step3Title', descKey: 'step3Desc' },
  { number: '04', titleKey: 'step4Title', descKey: 'step4Desc' },
];

/** Propose → Design & approve → Gate & build → Hand off. */
export function HowItWorks() {
  const t = useTranslations('landing.how');

  return (
    <section className="landing-blk landing-how" id="how">
      <div className="landing-wrap">
        <div className="landing-sec-head">
          <span className="landing-mono">{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <div className="landing-steps">
          {STEPS.map(({ number, titleKey, descKey }) => (
            <div className="landing-step" key={number}>
              <div className="landing-n landing-num">{number}</div>
              <div className="landing-bar" aria-hidden>
                <i />
              </div>
              <h3>{t(titleKey)}</h3>
              <p>{t(descKey)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
