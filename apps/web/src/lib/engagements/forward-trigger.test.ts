import { describe, expect, it } from 'vitest';
import {
  ENDING_TRIGGERS,
  endingChoicesFrom,
  isEndingTrigger,
  resolveForwardTrigger,
  secondaryTriggersOf,
} from './forward-trigger';
import { DESIGN_STATES } from './states';
import { TRANSITIONS, type Trigger } from './transitions';

describe('ENDING_TRIGGERS', () => {
  it('is exactly the two execution_decision exits', () => {
    expect([...ENDING_TRIGGERS].sort()).toEqual(['chooseDesignOnly', 'chooseExecution']);
    for (const trigger of ENDING_TRIGGERS) {
      expect(TRANSITIONS[trigger].from).toBe('execution_decision');
    }
  });

  it('every ending carries the identical guard list, so one checklist is truthful for both', () => {
    const guardLists = [...ENDING_TRIGGERS].map((trigger) => TRANSITIONS[trigger].guards);
    for (const guards of guardLists) expect(guards).toEqual(guardLists[0]);
  });

  it('isEndingTrigger agrees with the set', () => {
    for (const trigger of Object.keys(TRANSITIONS) as Trigger[]) {
      expect(isEndingTrigger(trigger)).toBe(ENDING_TRIGGERS.has(trigger));
    }
  });
});

describe('endingChoicesFrom', () => {
  it('is non-empty only at execution_decision', () => {
    for (const state of DESIGN_STATES) {
      const choices = endingChoicesFrom(state);
      if (state === 'execution_decision') {
        expect(choices).toEqual(['chooseDesignOnly', 'chooseExecution']);
      } else {
        expect(choices).toEqual([]);
      }
    }
  });
});

describe('secondaryTriggersOf', () => {
  it('drops the primary trigger and both endings, keeping order', () => {
    expect(
      secondaryTriggersOf(['chooseDesignOnly', 'chooseExecution', 'abandon'], null),
    ).toEqual(['abandon']);
    expect(
      secondaryTriggersOf(['optionsReady', 'designChangeRaised', 'abandon'], 'optionsReady'),
    ).toEqual(['designChangeRaised', 'abandon']);
  });
});

describe('resolveForwardTrigger never picks an ending', () => {
  it('is null at execution_decision', () => {
    expect(resolveForwardTrigger('execution_decision')).toBeNull();
  });

  it('returns neither ending for any of the 16 states', () => {
    for (const state of DESIGN_STATES) {
      const trigger = resolveForwardTrigger(state);
      expect(trigger === null || !isEndingTrigger(trigger), state).toBe(true);
    }
  });
});
