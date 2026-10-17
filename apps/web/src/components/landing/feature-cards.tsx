import { useTranslations } from 'next-intl';
import {
  BilingualIcon,
  CostIcon,
  type FeatureIcon,
  FlowIcon,
  ProposalsIcon,
} from './feature-icons';
import { FeatureSketch, type SketchKind } from './feature-sketches';

/** Where a card sits in the desktop bento; a phone shows one column. */
type BentoSpan = 'wide' | 'tall' | 'single';

interface FeatureDef {
  Icon: FeatureIcon;
  sketch: SketchKind;
  span: BentoSpan;
  titleKey: string;
  descKey: string;
}

const FEATURES: FeatureDef[] = [
  { Icon: FlowIcon, sketch: 'flow', span: 'wide', titleKey: 'flowTitle', descKey: 'flowDesc' },
  { Icon: CostIcon, sketch: 'cost', span: 'tall', titleKey: 'costTitle', descKey: 'costDesc' },
  {
    Icon: ProposalsIcon,
    sketch: 'proposals',
    span: 'single',
    titleKey: 'proposalsTitle',
    descKey: 'proposalsDesc',
  },
  {
    Icon: BilingualIcon,
    sketch: 'bilingual',
    span: 'single',
    titleKey: 'bilingualTitle',
    descKey: 'bilingualDesc',
  },
];

const SPAN_CLASS: Record<BentoSpan, string> = {
  wide: 'landing-feat landing-feat-wide',
  tall: 'landing-feat landing-feat-tall',
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
          {FEATURES.map(({ Icon, sketch, span, titleKey, descKey }) => (
            <article className={SPAN_CLASS[span]} key={titleKey}>
              <div className="landing-feat-ic">
                <Icon />
              </div>
              <h3>{t(titleKey)}</h3>
              <p>{t(descKey)}</p>
              <FeatureSketch kind={sketch} />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
