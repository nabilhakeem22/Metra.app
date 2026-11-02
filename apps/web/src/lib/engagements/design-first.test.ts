import { describe, expect, it } from 'vitest';
import {
  contractFromBoqRefusal,
  designFirstRefusal,
  designFirstTargetOf,
  executionGateOf,
  type PairDelivery,
} from './design-first';
import { ACTIVE_STATES, type DesignState } from './states';

function row(number: number, state: DesignState, entryPhase: PairDelivery['entryPhase'] = 'design'): PairDelivery {
  return { id: `d${number}`, number, createdAt: '2026-06-01T10:00:00Z', state, entryPhase };
}

describe('executionGateOf', () => {
  it('an empty pair, or only abandoned rows, has no delivery', () => {
    expect(executionGateOf([])).toEqual({ kind: 'no_delivery' });
    expect(executionGateOf([row(1, 'abandoned')])).toEqual({ kind: 'no_delivery' });
  });

  it.each([...ACTIVE_STATES])('%s is design_open, whatever else the pair holds', (state) => {
    const open = row(2, state);
    expect(executionGateOf([open])).toEqual({ kind: 'design_open', delivery: open });
    expect(executionGateOf([row(1, 'execution'), open, row(3, 'closed_design_only'), row(4, 'abandoned')])).toEqual({
      kind: 'design_open',
      delivery: open,
    });
  });

  it('execution is the home, the lowest number when old rows hold two', () => {
    expect(executionGateOf([row(5, 'execution')]).kind).toBe('home');
    const gate = executionGateOf([row(9, 'execution'), row(3, 'execution')]);
    expect(gate).toEqual({ kind: 'home', delivery: row(3, 'execution') });
  });

  it('execution wins over a closed design, and closed over abandoned', () => {
    expect(executionGateOf([row(1, 'closed_design_only'), row(2, 'execution')]).kind).toBe('home');
    expect(executionGateOf([row(1, 'closed_design_only'), row(2, 'abandoned')])).toEqual({
      kind: 'design_only_closed',
      delivery: row(1, 'closed_design_only'),
    });
  });

  it('design_only_handoff is still open', () => {
    expect(executionGateOf([row(1, 'design_only_handoff')]).kind).toBe('design_open');
  });
});

describe('designFirstRefusal', () => {
  it('names the delivery as DE-YYYY-NNNN, by its year in Cairo', () => {
    expect(designFirstRefusal(executionGateOf([row(9, 'boq')]))).toEqual({
      code: 'design_open',
      params: { delivery: 'DE-2026-0009', deliveryId: 'd9' },
    });
    const newYearsEve = { ...row(1, 'closed_design_only'), createdAt: new Date('2026-12-31T22:30:00Z') };
    expect(designFirstRefusal(executionGateOf([newYearsEve]))).toEqual({
      code: 'design_only_closed',
      params: { delivery: 'DE-2027-0001', deliveryId: 'd1' },
    });
  });

  it('has nothing to say to a home, or to no delivery', () => {
    expect(designFirstRefusal(executionGateOf([row(1, 'execution')]))).toBeNull();
    expect(designFirstRefusal(executionGateOf([]))).toBeNull();
  });
});

describe('contractFromBoqRefusal (rule 3)', () => {
  const home = executionGateOf([row(1, 'execution')]);
  const lightHome = executionGateOf([row(1, 'execution', 'execution')]);
  const none = executionGateOf([]);

  it("allows the home's own BOQ", () => {
    expect(contractFromBoqRefusal(home, { engagementId: 'd1' })).toBeNull();
    expect(contractFromBoqRefusal(lightHome, { engagementId: 'd1' })).toBeNull();
  });

  it('allows a BOQ with no delivery only at no_delivery or a light home', () => {
    expect(contractFromBoqRefusal(none, { engagementId: null })).toBeNull();
    expect(contractFromBoqRefusal(lightHome, { engagementId: null })).toBeNull();
    expect(contractFromBoqRefusal(home, { engagementId: null })).toEqual({ code: 'boq_not_on_home' });
  });

  it('refuses a BOQ on another row', () => {
    expect(contractFromBoqRefusal(home, { engagementId: 'old' })).toEqual({ code: 'boq_not_on_home' });
    expect(contractFromBoqRefusal(none, { engagementId: 'abandoned' })).toEqual({ code: 'boq_delivery_abandoned' });
  });

  it('answers the design gate first, naming the open row, even for the BOQ on an executing one', () => {
    const gate = executionGateOf([row(3, 'execution'), row(9, 'execution_decision')]);
    expect(contractFromBoqRefusal(gate, { engagementId: 'd3' })).toEqual({
      code: 'design_open',
      params: { delivery: 'DE-2026-0009', deliveryId: 'd9' },
    });
    expect(contractFromBoqRefusal(executionGateOf([row(2, 'closed_design_only')]), { engagementId: 'd2' })).toMatchObject({
      code: 'design_only_closed',
    });
  });
});

describe('designFirstTargetOf', () => {
  const params = { delivery: 'DE-2026-0009', deliveryId: 'd9' };

  it.each(['design_open', 'design_only_closed', 'contract_from_boq_only'] as const)('%s carries its target', (error) => {
    expect(designFirstTargetOf({ error, params })).toEqual(params);
  });

  it('is null for any other code, for no error and for params without a target', () => {
    expect(designFirstTargetOf({ error: 'boq_not_on_home', params })).toBeNull();
    expect(designFirstTargetOf({})).toBeNull();
    expect(designFirstTargetOf({ error: 'design_open' })).toBeNull();
    expect(designFirstTargetOf({ error: 'design_open', params: { delivery: 'DE', deliveryId: 4 } })).toBeNull();
  });
});
