// Decorative "Metra screen" sketches for the feature bento: skeleton rows, pills
// and bars in the landing palette, CSS only. No text, and aria-hidden — the
// card's heading and description carry the meaning.

import type { ComponentType } from 'react';

export type SketchKind = 'flow' | 'cost' | 'proposals' | 'bilingual';

type BarTone = 'strong' | 'brand';
type PillTone = 'brand' | 'good' | 'wait';

function Bar({ size, tone }: { size: number; tone?: BarTone }) {
  return (
    <i
      className={tone ? `landing-sk-bar is-${tone}` : 'landing-sk-bar'}
      style={{ inlineSize: `${size}%` }}
    />
  );
}

function Pill({ tone }: { tone: PillTone }) {
  return <i className={`landing-sk-pill is-${tone}`} />;
}

function Row({ size, end }: { size: number; end: PillTone | 'figure' }) {
  return (
    <div className="landing-sk-row">
      <Bar size={size} />
      {end === 'figure' ? <Bar size={18} tone="strong" /> : <Pill tone={end} />}
    </div>
  );
}

/** A delivery moving through its stages, and whose move each one is. */
function FlowScreen() {
  return (
    <>
      <div className="landing-sk-rail">
        <i className="is-done" />
        <i className="is-done" />
        <i className="is-on" />
        <i />
        <i />
      </div>
      <Row size={46} end="brand" />
      <Row size={36} end="good" />
      <Row size={52} end="wait" />
    </>
  );
}

const COST_COLUMNS = [42, 64, 50, 78, 58, 88, 70];

/** A budget meter, cost lines with their figures, and a spend chart. */
function CostScreen() {
  return (
    <>
      <div className="landing-sk-row">
        <Bar size={34} tone="strong" />
        <Bar size={20} tone="brand" />
      </div>
      <div className="landing-sk-meter">
        <i />
      </div>
      <Row size={44} end="figure" />
      <Row size={36} end="figure" />
      <Row size={50} end="figure" />
      <Row size={40} end="figure" />
      <Row size={30} end="figure" />
      <div className="landing-sk-cols">
        {COST_COLUMNS.map((height, index) => (
          <i key={index} style={{ blockSize: `${height}%` }} />
        ))}
      </div>
    </>
  );
}

/** A proposal page: lines, a total and the client's approve button. */
function ProposalsScreen() {
  return (
    <>
      <Bar size={54} tone="strong" />
      <Bar size={92} />
      <Bar size={80} />
      <Bar size={62} />
      <div className="landing-sk-row landing-sk-total">
        <Bar size={26} />
        <Bar size={24} tone="strong" />
      </div>
      <div className="landing-sk-row">
        <Pill tone="good" />
        <i className="landing-sk-btn" />
      </div>
    </>
  );
}

/** The same screen in both directions, one pane mirrored. */
function BilingualScreen() {
  return (
    <div className="landing-sk-split">
      {['landing-sk-pane', 'landing-sk-pane is-mirrored'].map((pane) => (
        <div className={pane} key={pane}>
          <Bar size={70} tone="strong" />
          <Bar size={90} />
          <Bar size={56} />
          <Pill tone="brand" />
        </div>
      ))}
    </div>
  );
}

const SCREENS: Record<SketchKind, ComponentType> = {
  flow: FlowScreen,
  cost: CostScreen,
  proposals: ProposalsScreen,
  bilingual: BilingualScreen,
};

export function FeatureSketch({ kind }: { kind: SketchKind }) {
  const Screen = SCREENS[kind];
  return (
    <div className="landing-sk" aria-hidden="true">
      <div className="landing-sk-top">
        <i />
        <i />
        <i />
      </div>
      <div className="landing-sk-body">
        <Screen />
      </div>
    </div>
  );
}
