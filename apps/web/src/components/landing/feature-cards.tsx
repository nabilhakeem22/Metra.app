import { useTranslations } from 'next-intl';
import {
  BilingualIcon,
  CostIcon,
  type FeatureIcon,
  FlowIcon,
  ProposalsIcon,
} from './feature-icons';

interface FeatureDef {
  Icon: FeatureIcon;
  titleKey: string;
  descKey: string;
}

const FEATURES: FeatureDef[] = [
  { Icon: FlowIcon, titleKey: 'flowTitle', descKey: 'flowDesc' },
  { Icon: CostIcon, titleKey: 'costTitle', descKey: 'costDesc' },
  { Icon: ProposalsIcon, titleKey: 'proposalsTitle', descKey: 'proposalsDesc' },
  { Icon: BilingualIcon, titleKey: 'bilingualTitle', descKey: 'bilingualDesc' },
];

/** The four feature cards — what a studio gets to run a fit-out. */
export function FeatureCards() {
  const t = useTranslations('landing.features');

  return (
    <section
      className="landing-blk"
      id="features"
      style={{ paddingBlockStart: '20px' }}
    >
      <div className="landing-wrap">
        <div className="landing-sec-head">
          <span className="landing-mono">{t('eyebrow')}</span>
          <h2>{t('title')}</h2>
          <p>{t('subtitle')}</p>
        </div>
        <div className="landing-feats">
          {FEATURES.map(({ Icon, titleKey, descKey }) => (
            <article className="landing-feat" key={titleKey}>
              <div className="landing-feat-ic">
                <Icon />
              </div>
              <h3>{t(titleKey)}</h3>
              <p>{t(descKey)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
