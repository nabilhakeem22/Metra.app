import { describe, expect, it } from 'vitest';
import { isAmbiguousDbOutcome } from './db-failure';
import {
  isImmutabilityViolation,
  isUniqueViolation,
  isUniqueViolationOf,
} from './db-conflict';

describe('isUniqueViolation', () => {
  it('recognises 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('is false for MT100, a plain Error, null and a non-string code', () => {
    expect(isUniqueViolation({ code: 'MT100' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation({ code: 23505 })).toBe(false);
  });
});

describe('isUniqueViolationOf', () => {
  const CONSTRAINT = 'contracts_org_id_source_proposal_unique';

  it('is true only when the SQLSTATE and the constraint name both match', () => {
    expect(
      isUniqueViolationOf({ code: '23505', constraint_name: CONSTRAINT }, CONSTRAINT),
    ).toBe(true);
  });

  it('is false for a 23505 raised by a DIFFERENT constraint on the same table', () => {
    // The whole point: `generateContractCore` runs five phases in one
    // transaction, and a collision on the contract NUMBER means the allocator
    // failed. Answering it "a contract already exists" would dress a defect as
    // an expected race and delete its log line.
    expect(
      isUniqueViolationOf(
        { code: '23505', constraint_name: 'contracts_org_id_number_unique' },
        CONSTRAINT,
      ),
    ).toBe(false);
  });

  it('is false when the server attributed the error to no constraint at all', () => {
    expect(isUniqueViolationOf({ code: '23505' }, CONSTRAINT)).toBe(false);
    expect(isUniqueViolationOf({ code: '23505', constraint_name: '' }, CONSTRAINT)).toBe(
      false,
    );
    expect(isUniqueViolationOf({ code: '23505', constraint_name: 7 }, CONSTRAINT)).toBe(
      false,
    );
  });

  it('is false for the right constraint under the WRONG SQLSTATE', () => {
    expect(
      isUniqueViolationOf({ code: 'MT100', constraint_name: CONSTRAINT }, CONSTRAINT),
    ).toBe(false);
    expect(isUniqueViolationOf(null, CONSTRAINT)).toBe(false);
  });

  it('refuses a code and a constraint name that came from DIFFERENT errors (S3)', () => {
    // The pair has to describe ONE refusal. Two independent walks would each
    // stop at the outermost node carrying THEIR field: the 23505 off the outer
    // error, the constraint name off the inner one — and answer "the race you
    // named" to a collision neither error reported. `driverRefusalOf` reads both
    // off the node that carried the code, so the inner name is not in scope.
    const mixedNodes = {
      code: '23505',
      cause: { code: '23514', constraint_name: CONSTRAINT },
    };
    expect(isUniqueViolationOf(mixedNodes, CONSTRAINT)).toBe(false);

    // The mirror: the name on the OUTER node, the 23505 on the inner one.
    const mirrored = {
      constraint_name: CONSTRAINT,
      cause: { code: '23505', constraint_name: 'some_other_index' },
    };
    expect(isUniqueViolationOf(mirrored, CONSTRAINT)).toBe(false);

    // ...and the control: one node carrying both is still answered.
    expect(
      isUniqueViolationOf({ cause: { code: '23505', constraint_name: CONSTRAINT } }, CONSTRAINT),
    ).toBe(true);
  });
});

describe('isImmutabilityViolation', () => {
  it('recognises MT100', () => {
    expect(isImmutabilityViolation({ code: 'MT100' })).toBe(true);
  });

  it('is false for 23505, a plain Error and null', () => {
    expect(isImmutabilityViolation({ code: '23505' })).toBe(false);
    expect(isImmutabilityViolation(new Error('boom'))).toBe(false);
    expect(isImmutabilityViolation(null)).toBe(false);
  });
});

describe('a drizzle-wrapped driver error reads exactly like a bare one', () => {
  // From drizzle-orm 0.44 every error raised by a query the ORM ran is
  // re-thrown with the driver's error on `.cause`. These classifiers decide
  // whether an immutability refusal is a sentence or a 500, and whether a 23505
  // is the race the caller named — so the wrapper must be invisible to them.
  const wrap = (driver: unknown) =>
    Object.assign(
      new Error('Failed query: update public.proposals set total = $1\nparams: 1'),
      { cause: driver },
    );
  const CONSTRAINT = 'contracts_org_id_source_proposal_unique';

  it('sees 23505 and MT100 through the wrapper', () => {
    expect(isUniqueViolation(wrap({ code: '23505' }))).toBe(true);
    expect(isImmutabilityViolation(wrap({ code: 'MT100' }))).toBe(true);
  });

  it('sees the constraint name through the wrapper', () => {
    expect(
      isUniqueViolationOf(
        wrap({ code: '23505', constraint_name: CONSTRAINT }),
        CONSTRAINT,
      ),
    ).toBe(true);
  });

  it('still refuses a wrapped 23505 raised by a DIFFERENT constraint', () => {
    expect(
      isUniqueViolationOf(
        wrap({ code: '23505', constraint_name: 'contracts_org_id_number_unique' }),
        CONSTRAINT,
      ),
    ).toBe(false);
  });

  it('is false for the wrapper alone — it carries no SQLSTATE of its own', () => {
    expect(isUniqueViolation(wrap(undefined))).toBe(false);
    expect(isImmutabilityViolation(wrap(undefined))).toBe(false);
    expect(isUniqueViolationOf(wrap(undefined), CONSTRAINT)).toBe(false);
  });
});

describe('a refusal is never confused with an ambiguous outcome', () => {
  it('55P03 stays AMBIGUOUS and reaches neither classifier', () => {
    // The ordering inside mutationFailureCode depends on this: a lock timeout
    // must surface as `uncertain` so the caller HOLDS its idempotency key. If it
    // could also read as a named conflict, a retry would mint a fresh key.
    expect(isAmbiguousDbOutcome({ code: '55P03' })).toBe(true);
    expect(isUniqueViolation({ code: '55P03' })).toBe(false);
    expect(isImmutabilityViolation({ code: '55P03' })).toBe(false);
  });

  it('23505 and MT100 are NOT ambiguous', () => {
    expect(isAmbiguousDbOutcome({ code: '23505' })).toBe(false);
    expect(isAmbiguousDbOutcome({ code: 'MT100' })).toBe(false);
  });
});
