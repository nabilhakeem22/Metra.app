import { describe, expect, it } from 'vitest';
import { DESIGN_STATES } from '../states';
import { deliveredAt, parseTimeline, TIMELINE_MAX_ENTRIES } from './timeline-rows';

// Round C (task 40): the raw timeline of app_delivery_by_token in client words.
// Every malformed or unknown entry is dropped, never thrown and never forwarded.

const AT = '2026-10-01T09:30:00.123456+03:00';
const ISO = '2026-10-01T06:30:00.123Z';

const stage = (state: unknown, at: unknown = AT) => ({ type: 'stage', state, at });
const decision = (kind: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'decision',
  kind,
  at: AT,
  by_studio: false,
  option_position: null,
  ...extra,
});
const payment = (kind: unknown, amount: unknown) => ({ type: 'payment', kind, amount, at: AT });

describe('parseTimeline', () => {
  it('translates a state into its stage key and normalises the instant', () => {
    expect(parseTimeline([stage('final_approval')])).toEqual([{ type: 'stage', stageKey: 'finalApproval', at: ISO }]);
  });

  it('translates every decision kind; a concept approval naming an option is a choice with its letter', () => {
    expect(
      parseTimeline([
        decision('concept_approval', { option_position: 2 }),
        decision('concept_approval'),
        decision('concept_change_request'),
        decision('design_approval', { by_studio: true }),
        decision('design_change_request'),
        decision('rom_acknowledgement'),
        decision('handoff_acknowledgement', { by_studio: true }),
      ]).map((entry) => (entry.type === 'decision' ? [entry.decision, entry.byStudio, entry.letter] : null)),
    ).toEqual([
      ['concept_chosen', false, 'B'],
      ['concept_approved', false, null],
      ['concept_changes', false, null],
      ['design_approved', true, null],
      ['design_changes', false, null],
      ['budget_acknowledged', false, null],
      ['handover_acknowledged', true, null],
    ]);
  });

  it('keeps payments of the five kinds with a positive scale-4 amount', () => {
    expect(parseTimeline([payment('deposit', '30000.0000'), payment('revision_co', '1500.5000')])).toEqual([
      { type: 'payment', kind: 'deposit', amount: '30000.0000', at: ISO },
      { type: 'payment', kind: 'revision_co', amount: '1500.5000', at: ISO },
    ]);
  });

  it('drops every malformed or unknown entry, never throws', () => {
    const junk = [
      null,
      7,
      'stage',
      {},
      stage('not_a_state'),
      stage('survey', 'yesterday'),
      stage('survey', '2026-10-01'),
      stage('survey', '2026-13-45T99:00:00Z'),
      decision('as_built_attestation'),
      decision('design_approval', { by_studio: 'yes' }),
      decision('design_approval', { by_studio: undefined }),
      payment('refund', '10.0000'),
      payment('deposit', '-10.0000'),
      payment('deposit', '0.0000'),
      payment('deposit', '1e5'),
      payment('deposit', 30000),
      { type: 'note', at: AT },
    ];
    expect(parseTimeline(junk)).toEqual([]);
    expect(parseTimeline('nope')).toEqual([]);
    expect(parseTimeline(undefined)).toEqual([]);
  });

  it('collapses neighbouring stage entries that read as the same client stage, keeping the newest', () => {
    const newer = '2026-10-02T10:00:00Z';
    const parsed = parseTimeline([stage('final_approval', newer), stage('final_approval'), stage('design_3d')]);
    expect(parsed.map((entry) => (entry.type === 'stage' ? [entry.stageKey, entry.at] : null))).toEqual([
      ['finalApproval', '2026-10-02T10:00:00.000Z'],
      ['visuals', ISO],
    ]);
  });

  it('never carries more entries than the database may send', () => {
    const many = Array.from({ length: 80 }, () => payment('deposit', '1.0000'));
    expect(parseTimeline(many)).toHaveLength(TIMELINE_MAX_ENTRIES);
  });

  it('forwards no raw machine key: no state name, no event kind, no snake_case field', () => {
    const raw = [...DESIGN_STATES.map((state) => stage(state)), decision('concept_approval', { option_position: 1 })];
    const json = JSON.stringify(parseTimeline(raw));
    for (const word of [...DESIGN_STATES, 'concept_approval', 'by_studio', 'option_position']) {
      expect(json, word).not.toContain(`"${word}"`);
    }
  });
});

describe('deliveredAt', () => {
  it('is the newest delivered or construction stage entry, else null', () => {
    const timeline = parseTimeline([payment('balance', '5.0000'), stage('closed_design_only'), stage('design_only_handoff')]);
    expect(deliveredAt(timeline)).toBe(ISO);
    expect(deliveredAt(parseTimeline([stage('execution')]))).toBe(ISO);
    expect(deliveredAt(parseTimeline([stage('boq')]))).toBeNull();
  });
});
