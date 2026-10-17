import { useTranslations } from 'next-intl';
import {
  BilingualIcon,
  CostIcon,
  type FeatureIcon,
  FlowIcon,
  ProposalsIcon,
} from './feature-icons';
import { FeatureScreen } from './feature-screen';
import type { ScreenKind } from './feature-screens';

/** Where a card sits in the desktop bento; a phone shows one column. */
type BentoSpan = 'wide' | 'single';

interface FeatureDef {
  Icon: FeatureIcon;
  screen: ScreenKind;
  span: BentoSpan;
  titleKey: string;
  descKey: string;
}

const FEATURES: FeatureDef[] = [
  { Icon: FlowIcon, screen: 'flow', span: 'wide', titleKey: 'flowTitle', descKey: 'flowDesc' },
  { Icon: CostIcon, screen: 'cost', span: 'single', titleKey: 'costTitle', descKey: 'costDesc' },
  {
    Icon: ProposalsIcon,
    screen: 'proposals',
    span: 'single',
    titleKey: 'proposalsTitle',
    descKey: 'proposalsDesc',
  },
  {
    Icon: BilingualIcon,
    screen: 'bilingual',
    span: 'wide',
    titleKey: 'bilingualTitle',
    descKey: 'bilingualDesc',
  },
];

const SPAN_CLASS: Record<BentoSpan, string> = {
  wide: 'landing-feat landing-feat-wide',
  single: 'landing-feat',
};

/** The four feature cards, as a bento — what a studio gets to run a fit-out. */
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
          {FEATURES.map(({ Icon, screen, span, titleKey, descKey }) => (
            <article className={SPAN_CLASS[span]} key={titleKey}>
              <div className="landing-feat-ic">
                <Icon />
              </div>
              <h3>{t(titleKey)}</h3>
              <p>{t(descKey)}</p>
              <FeatureScreen kind={screen} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
