import { describe, expect, it } from 'vitest';
import {
  MILESTONE_STATUSES,
  STATE_SET,
  isRenderableClaim,
  isRenderableDocument,
  isRenderableMilestone,
} from './row-guards';

// These three predicates stand between EXTERNAL jsonb and a client's screen. They
// were unreachable from a unit test while they lived inside the 409-line
// `public.ts` — the only way in was to drive a mocked database through
// getDeliveryByToken, which is why `delivery.test.ts` is 297 lines of mocked
// snapshots. They are pure functions over `unknown`; they deserve to be poked
// directly with the shapes a malformed row actually takes.

/** Every shape that is not an object, plus the two that pretend to be one. */
const NOT_OBJECTS = [null, undefined, 0, 1, '', 'x', true, false, NaN];

describe('isRenderableDocument', () => {
  it('accepts a row carrying an id and a mapped kind', () => {
    expect(isRenderableDocument({ id: 'f1', kind: 'concept_option' })).toBe(true);
  });

  it('refuses anything that is not an object', () => {
    for (const row of NOT_OBJECTS) expect(isRenderableDocument(row)).toBe(false);
  });

  it('refuses a missing, empty or non-string id — it is the download filter', () => {
    expect(isRenderableDocument({ kind: 'concept_option' })).toBe(false);
    expect(isRenderableDocument({ id: '', kind: 'concept_option' })).toBe(false);
    expect(isRenderableDocument({ id: 7, kind: 'concept_option' })).toBe(false);
    expect(isRenderableDocument({ id: null, kind: 'concept_option' })).toBe(false);
  });

  it('refuses a kind the portal has no client-facing category for', () => {
    // The case this exists for: an artifact kind added to the DB enum before the
    // portal learns a friendly name for it. Dropping the row shows a shorter
    // list; rendering it shows the client an unnamed file.
    expect(isRenderableDocument({ id: 'f1', kind: 'not_a_kind' })).toBe(false);
    expect(isRenderableDocument({ id: 'f1' })).toBe(false);
  });
});

describe('isRenderableClaim', () => {
  it('accepts a row carrying both fields the portal dereferences', () => {
    expect(
      isRenderableClaim({ milestone_kind: 'deposit', amount_remaining: '100.0000' }),
    ).toBe(true);
  });

  it('refuses anything that is not an object', () => {
    for (const row of NOT_OBJECTS) expect(isRenderableClaim(row)).toBe(false);
  });

  it('refuses an empty or non-string milestone_kind', () => {
    expect(isRenderableClaim({ milestone_kind: '', amount_remaining: '1' })).toBe(false);
    expect(isRenderableClaim({ milestone_kind: 3, amount_remaining: '1' })).toBe(false);
    expect(isRenderableClaim({ amount_remaining: '1' })).toBe(false);
  });

  it('refuses a numeric amount_remaining — money crosses the wire as a string', () => {
    // A number here would already have lost scale-4 precision by the time it was
    // parsed out of jsonb; the guard is what keeps that off the claim button.
    expect(isRenderableClaim({ milestone_kind: 'deposit', amount_remaining: 100 })).toBe(
      false,
    );
    expect(isRenderableClaim({ milestone_kind: 'deposit', amount_remaining: '' })).toBe(
      false,
    );
    expect(isRenderableClaim({ milestone_kind: 'deposit' })).toBe(false);
  });
});

describe('isRenderableMilestone', () => {
  const valid = {
    milestone_kind: 'deposit',
    basis: 'x',
    amount_due: '10000.0000',
    amount_cleared: '0',
    status: 'paid',
  };

  it('accepts a row with a kind, a known status and an amount_due', () => {
    expect(isRenderableMilestone(valid)).toBe(true);
  });

  it('accepts every status the portal knows how to render, and only those', () => {
    for (const status of ['paid', 'partial', 'due']) {
      expect(isRenderableMilestone({ ...valid, status })).toBe(true);
    }
    for (const status of ['void', 'PAID', '', 'pending', 0, null]) {
      expect(isRenderableMilestone({ ...valid, status })).toBe(false);
    }
  });

  it('refuses anything that is not an object', () => {
    for (const row of NOT_OBJECTS) expect(isRenderableMilestone(row)).toBe(false);
  });

  it('refuses a null amount_due but accepts a zero one', () => {
    // `!= null` not a truthiness check: a genuinely zero milestone is renderable,
    // and '0' / 0 must not be mistaken for "no amount".
    expect(isRenderableMilestone({ ...valid, amount_due: null })).toBe(false);
    expect(isRenderableMilestone({ ...valid, amount_due: undefined })).toBe(false);
    expect(isRenderableMilestone({ ...valid, amount_due: '0' })).toBe(true);
    expect(isRenderableMilestone({ ...valid, amount_due: 0 })).toBe(true);
  });
});

describe('the sets the guards read against', () => {
  it('knows the money statuses and nothing else', () => {
    expect([...MILESTONE_STATUSES].sort()).toEqual(['due', 'paid', 'partial']);
  });

  it('holds every design state, so a real state is never dropped as unknown', () => {
    // getDeliveryByToken returns null for a state outside this set. If the set
    // ever fell behind DESIGN_STATES, a live delivery would render as not-found.
    expect(STATE_SET.has('concept_review')).toBe(true);
    expect(STATE_SET.has('not_a_state')).toBe(false);
    expect(STATE_SET.size).toBeGreaterThan(3);
  });
});
