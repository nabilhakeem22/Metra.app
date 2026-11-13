import { describe, expect, it } from 'vitest';
import { unansweredFailure } from './portal-failure';

// Which answers a link page (/p, /c, /v) keeps OPEN and says from
// `portal.errors`: the acts that never landed. Any other refusal is an outcome
// the page says in its own words (a decision already made, a dead link).

describe('unansweredFailure', () => {
  it('a landed answer is no failure', () => {
    expect(unansweredFailure({ ok: true })).toBeNull();
  });

  it('P4a: an act the link budget refused is said as too_many, and the decision stays open', () => {
    expect(unansweredFailure({ ok: false, error: 'too_many' })).toEqual({ error: 'too_many' });
  });

  it('an unconfirmed write is uncertain; an unknown failure keeps its reference', () => {
    expect(unansweredFailure({ ok: false, error: 'uncertain' })).toEqual({ error: 'uncertain' });
    expect(unansweredFailure({ ok: false, error: 'generic', reference: 'K7Q29MXD' })).toEqual({ error: 'generic', reference: 'K7Q29MXD' });
  });

  it.each(['token_invalid', 'token_expired', 'already_responded', 'moved', undefined])(
    'a refusal of %j is an outcome, not an unanswered act',
    (error) => {
      expect(unansweredFailure({ ok: false, error })).toBeNull();
    },
  );
});
