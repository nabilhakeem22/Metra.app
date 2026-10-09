import { describe, expect, it } from 'vitest';
import { PORTAL_STAGE_KEY, PORTAL_STAGE_KEYS } from './portal-stage';
import { shapeDelivery } from './public/delivery-shape';
import { DESIGN_STATES } from './states';

// AC 21: the client's stage is a CLIENT word. No stage key may equal a machine
// state name, so a stage key in the browser payload can never be a leaked
// state, and the mapped delivery for every state carries no `state` at all.

const STATE_NAMES = new Set<string>(DESIGN_STATES);

describe('PORTAL_STAGE_KEY', () => {
  it('maps every one of the 16 machine states to a stage key from the union', () => {
    expect(DESIGN_STATES).toHaveLength(16);
    for (const state of DESIGN_STATES) {
      expect(PORTAL_STAGE_KEYS).toContain(PORTAL_STAGE_KEY[state]);
    }
  });

  it('uses each stage key once: 16 states, 16 client words', () => {
    expect(new Set(Object.values(PORTAL_STAGE_KEY)).size).toBe(PORTAL_STAGE_KEYS.length);
    expect(PORTAL_STAGE_KEYS).toHaveLength(16);
  });

  it('no stage key equals a machine state name', () => {
    for (const key of PORTAL_STAGE_KEYS) {
      expect(STATE_NAMES.has(key), key).toBe(false);
    }
  });
});

describe('the mapped delivery carries a stage key, never a state', () => {
  it.each([...DESIGN_STATES])('%s', (state) => {
    const delivery = shapeDelivery({ id: 'de-1', number: 3, state });
    expect(delivery).not.toBeNull();
    expect(Object.keys(delivery!)).not.toContain('state');
    expect(delivery!.stageKey).toBe(PORTAL_STAGE_KEY[state]);
    expect(PORTAL_STAGE_KEYS).toContain(delivery!.stageKey);
    // Nowhere in the payload does the raw state name appear as a value.
    expect(JSON.stringify(delivery)).not.toContain(`"${state}"`);
  });
});
